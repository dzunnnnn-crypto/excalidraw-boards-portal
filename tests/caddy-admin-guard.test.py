"""Linux unit checks with a mocked nft runner; never modify host firewall."""
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / 'deploy/security/caddy-admin-guard.py'
spec = importlib.util.spec_from_file_location('admin_guard', source)
guard_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard_module)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.rules = Path(self.folder.name) / 'rules.nft'
        self.rules.write_text(guard_module.RULES)
        self.rules.chmod(0o600)
        self.table = None
        self.calls = []
        self.guard = guard_module.Guard(self.rules, self.runner)
        # Identity and file ownership are mocked, not changed on the machine.
        user = patch.object(guard_module.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=993))
        user.start()
        self.addCleanup(user.stop)
        trusted = patch.object(guard_module, 'trusted_file', side_effect=lambda p: p.read_text())
        trusted.start()
        self.addCleanup(trusted.stop)

    def runner(self, args, **kwargs):
        self.calls.append(args)
        command = args[1:]
        if command == ['--json', 'list', 'tables']:
            value = {'nftables': [{'table': {'family': 'inet', 'name': 'unrelated'}}]}
            if self.table is not None:
                value['nftables'].append({'table': {'family': 'inet', 'name': guard_module.TABLE}})
        elif command == ['--json', 'list', 'table', 'inet', guard_module.TABLE]:
            value = self.table
        elif command == ['--check', '--file', '-']:
            self.assertEqual(kwargs['input'], guard_module.RULES)
            value = {}
        elif command == ['--file', '-']:
            self.assertIsNone(self.table)
            self.table = guard_module.expected_table()
            value = {}
        elif command == ['delete', 'table', 'inet', guard_module.TABLE]:
            self.table = None
            value = {}
        else:
            self.fail('Unexpected nft command: ' + repr(command))
        return types.SimpleNamespace(returncode=0, stdout=json.dumps(value), stderr='')

    def test_idempotent_start_stop_and_narrow_commands(self):
        self.assertEqual(self.guard.start(), 'protected')
        self.assertEqual(self.guard.start(), 'already-protected')
        self.assertEqual(self.guard.stop(), 'removed')
        self.assertEqual(self.guard.stop(), 'already-absent')
        writes = [c for c in self.calls if c[1:3] == ['--file', '-']]
        self.assertEqual(len(writes), 1)

    def test_unknown_existing_table_is_preserved(self):
        self.table = {'nftables': [{'table': {'family': 'inet', 'name': guard_module.TABLE}}]}
        before = json.dumps(self.table)
        for operation in [self.guard.start, self.guard.stop]:
            with self.assertRaisesRegex(RuntimeError, 'differs'):
                operation()
        self.assertEqual(json.dumps(self.table), before)

    def test_modified_rules_and_changed_uid_are_refused(self):
        self.rules.write_text(guard_module.RULES + '# modified\n')
        with self.assertRaisesRegex(RuntimeError, 'template'):
            self.guard.start()
        self.rules.write_text(guard_module.RULES)
        with patch.object(guard_module.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=994)):
            with self.assertRaisesRegex(RuntimeError, 'UID changed'):
                self.guard.start()
        self.assertIsNone(self.table)

    def test_counters_and_handles_are_ignored_but_rules_are_not(self):
        self.guard.start()
        self.table['nftables'].insert(0, {'metainfo': {'json_schema_version': 1}})
        for record in self.table['nftables']:
            if 'rule' in record:
                record['rule']['handle'] = 123
                record['rule']['expr'][3]['counter'] = {'packets': 7, 'bytes': 1024}
        self.assertEqual(self.guard.start(), 'already-protected')
        self.table['nftables'][-1]['rule']['expr'][2]['match']['right'] = 9999
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            self.guard.stop()


if __name__ == '__main__':
    unittest.main()
