# Build-only native helper, not redistributed

@napi-rs/lzma-linux-x64-gnu 1.5.1 is an optional native compression helper
of Rollup 4.62.4. It is installed only in the build environment and removed
by npm prune --omit=dev. Its native .node file is not part of this release.

The published package manifest declares MIT. Neither the installed platform
package nor the source repository supplies a standalone license document.
This reference does not invent a copyright holder or replace a license.
Redistributing that native helper would require a separate license review.

Package metadata: https://registry.npmjs.org/@napi-rs%2flzma/1.5.1
Source gitHead from that metadata:
https://github.com/Brooooooklyn/lzma/tree/f164df92d83e095f195d628b1a68a141ae2eb638

The release verifier rejects an archive if this package is present in runtime
node_modules. The inventory marks it build-only-not-distributed, and retains
its package metadata for transparency, rather than claiming a collected license.
