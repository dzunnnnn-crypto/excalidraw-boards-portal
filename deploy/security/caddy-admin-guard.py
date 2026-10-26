#!/usr/bin/python3
"""Narrow, root-owned guard for this deployment; never replace unrelated nft tables."""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess

TABLE = 'excalidraw_admin_guard'
SERVICE_USER = 'excalidraw'
SERVICE_UID = 993
RULES_PATH = Path('/etc/excalidraw-portal/caddy-admin-guard.nft')
LOCK_DIR = Path('/run/excalidraw-admin-guard')
RULES = '''table inet excalidraw_admin_guard {
  chain output {
    type filter hook output priority -10; policy accept;
    meta skuid 993 ip daddr 127.0.0.1 tcp dport 2019 counter reject with tcp reset
    meta skuid 993 ip6 daddr ::1 tcp dport 2019 counter reject with tcp reset
  }
}
'''


def normalized(value):
    if isinstance(value, dict):
        return {k: ({} if k == 'counter' and isinstance(v, dict) else normalized(v))
                for k, v in value.items() if k != 'handle'}
    if isinstance(value, list):
        return [normalized(v) for v in value if not (isinstance(v, dict) and 'metainfo' in v)]
    return value


def expected_table():
    records = [
        {'table': {'family': 'inet', 'name': TABLE}},
        {'chain': {'family': 'inet', 'table': TABLE, 'name': 'output',
                   'type': 'filter', 'hook': 'output', 'prio': -10, 'policy': 'accept'}},
    ]
    for protocol, address in [('ip', '127.0.0.1'), ('ip6', '::1')]:
        expr = [
            {'match': {'op': '==', 'left': {'meta': {'key': 'skuid'}}, 'right': SERVICE_UID}},
            {'match': {'op': '==', 'left': {'payload': {'protocol': protocol, 'field': 'daddr'}}, 'right': address}},
            {'match': {'op': '==', 'left': {'payload': {'protocol': 'tcp', 'field': 'dport'}}, 'right': 2019}},
            {'counter': {}}, {'reject': {'type': 'tcp reset'}},
        ]
        records.append({'rule': {'family': 'inet', 'table': TABLE, 'chain': 'output', 'expr': expr}})
    return {'nftables': records}


def trusted_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError('Expected a regular root-owned file without group/other write access')
    return path.read_text(encoding='utf-8')


class Guard:
    def __init__(self, rules_path=RULES_PATH, runner=subprocess.run):
        self.rules_path, self.runner = Path(rules_path), runner

    def nft(self, *args, text=None):
        result = self.runner(['/usr/sbin/nft', *args], input=text, text=True,
                             capture_output=True, timeout=15)
        if result.returncode:
            raise RuntimeError('nft operation failed: ' + result.stderr.strip()[:500])
        return result.stdout

    def table(self):
        entries = json.loads(self.nft('--json', 'list', 'tables'))['nftables']
        matches = [x['table'] for x in entries if 'table' in x
                   and x['table'].get('family') == 'inet' and x['table'].get('name') == TABLE]
        if not matches:
            return None
        if len(matches) != 1:
            raise RuntimeError('Ambiguous guard table')
        result = json.loads(self.nft('--json', 'list', 'table', 'inet', TABLE))
        if normalized(result) != expected_table():
            raise RuntimeError('Guard table differs from the approved rules; refusing to modify it')
        return result

    def start(self):
        if pwd.getpwnam(SERVICE_USER).pw_uid != SERVICE_UID:
            raise RuntimeError('Service UID changed; review the guard configuration first')
        if trusted_file(self.rules_path) != RULES:
            raise RuntimeError('Rule file differs from the reviewed template')
        if self.table() is not None:
            return 'already-protected'
        self.nft('--check', '--file', '-', text=RULES)
        self.nft('--file', '-', text=RULES)
        if self.table() is None:
            raise RuntimeError('Guard table was not installed')
        return 'protected'

    def stop(self):
        if self.table() is None:
            return 'already-absent'
        self.nft('delete', 'table', 'inet', TABLE)
        if self.table() is not None:
            raise RuntimeError('Guard table remains present')
        return 'removed'


@contextlib.contextmanager
def locked():
    LOCK_DIR.mkdir(mode=0o700, exist_ok=True)
    info = LOCK_DIR.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('Unsafe lock directory')
    fd = os.open(LOCK_DIR / 'lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError('Unsafe lock file')
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    action = parser.parse_args().action
    if os.geteuid() != 0:
        parser.error('Root is required to inspect or manage this guard')
    with locked():
        guard = Guard()
        result = 'protected' if action == 'status' and guard.table() is not None else (
            'absent' if action == 'status' else getattr(guard, action)())
    print(json.dumps({'guard': TABLE, 'result': result}))


if __name__ == '__main__':
    main()
