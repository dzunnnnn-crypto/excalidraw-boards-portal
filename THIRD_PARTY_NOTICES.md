# Third-party notices

Portal, access control, deployment configuration and gateway extensions: Copyright (c) 2026 Дмитрий Дзяткевич, MIT (LICENSE).

The drawing engine is **yctimlin/mcp_excalidraw**:
https://github.com/yctimlin/mcp_excalidraw
Pinned revision: 8084a1c8b410d625fcfd59d5cffb32f3a86a2a6f.
MIT, Copyright (c) 2024 MCP Excalidraw Server.
Full license: docs/licenses/MCP-EXCALIDRAW-MIT.txt.

The editor uses **Excalidraw**, https://github.com/excalidraw/excalidraw,
MIT, Copyright (c) 2020 Excalidraw. We did not create the drawing engine,
basic element tools, renderer, or original synchronization implementation.
Our patches extend the upstream interface and server for the portal.

The original engine LICENSE, package-lock.json and dependency licenses are
retained when setup downloads the pinned source. Distributed runtime builds
must retain those notices and licenses, including bundled fonts. A generated
inventory is included in release artifacts. Root LICENSE does not replace
licenses of dependencies.

Release artifacts include THIRD_PARTY_INVENTORY.json and THIRD_PARTY_LICENSES/.
These are collected from ALL installed packages before pruning devDependencies,
so browser libraries and bundled Node-exporter libraries retain their original
license and NOTICE documents even after their package folders are removed.
The inventory is a conservative superset including build tools, not an exact
per-chunk software bill of materials. Entries retain package name, version,
license identifier, metadata, document source and document checksums.
LicenseRef-packaged-text means the package did not declare an identifier;
consult its preserved license text rather than assuming a license.

Packages with an upstream license embedded in their README retain that README.
Reviewed fallback license snapshots and their URLs/SHA256 are in
docs/licenses/sources.json. Builds use these local snapshots without fetching
legal documents dynamically. Native platform packages use the corresponding
same-version parent package license. Original notices in JS remain unchanged.
One optional Rollup native helper has no supplied license text and is marked
build-only-not-distributed. Its manifest and source reference are retained;
the archive verifier requires that helper to be absent from runtime.
See docs/licenses/BUILD-ONLY-NAPI-LZMA.md.

Assistant browser fonts are OFL-1.1, Copyright 2020 The Assistant Project Authors
and Copyright 2010 The Source Sans Pro Authors, Reserved Font Name Source.
Full notice: docs/licenses/ASSISTANT-OFL.txt. The separate headless font notice
from pinned upstream assets/fonts/LICENSES.md is also retained in every release.
Each distributed WOFF/WOFF2/TTF/OTF asset in dist/assets is individually listed
with its content hash and associated notice. Unknown assets block the build.
