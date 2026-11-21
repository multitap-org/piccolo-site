#!/bin/sh
# Writes assets/v1/MANIFEST: one "sha256  path" line per file (sha256sum's
# format), the list the other sites fetch and check (assets/v1/README.md).
# Run after changing anything in assets/v1/; CI fails when it's stale.
set -eu
cd "$(dirname "$0")/../assets/v1"
find . -type f ! -name 'MANIFEST*' ! -name '.*' | sed 's|^\./||' | LC_ALL=C sort | xargs sha256sum > MANIFEST.tmp
mv MANIFEST.tmp MANIFEST
