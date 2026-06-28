#!/usr/bin/env bash
# OKF bundle sync orchestrator (no git, no push).
#
# Refreshes the canonical validator scripts in the bundle and runs all
# four conformance validators. Aborts on any error.
#
# Usage:
#   sync-from-upstream.sh <bundle-dir>
#
#   bundle-dir : path to the OKF bundle root (contains okf/, or is
#                itself the okf/ directory)
#
# Env vars (optional):
#   OKF_SCRIPTS : directory containing the OKF canonical scripts
#                 (defaults to the directory containing this script)
#
# Exit codes:
#   0  : success
#   1  : any validator failed (bundle does not conform)
#   2  : usage error / missing input
#
# Steps performed (in order):
#   1. Copy/refresh the validator scripts from OKF_SCRIPTS into
#      <bundle-dir>/okf/scripts/ if missing or outdated.
#   2. Run all four validators against the bundle. Abort on any error.
#   3. Print a summary.

set -euo pipefail

bundle_dir="${1:-}"

if [ -z "$bundle_dir" ]; then
  echo "usage: $0 <bundle-dir>" >&2
  exit 2
fi

if [ ! -d "$bundle_dir" ]; then
  echo "error: bundle-dir is not a directory: $bundle_dir" >&2
  exit 2
fi

# Resolve the actual okf/ subdir if the bundle-dir points at its parent.
if [ -d "$bundle_dir/okf" ]; then
  okf_root="$bundle_dir/okf"
else
  okf_root="$bundle_dir"
fi

# Default OKF_SCRIPTS to the directory containing this script. If you
# invoke sync-from-upstream.sh from anywhere, it looks next to itself
# for the canonical scripts.
script_dir="$(cd "$(dirname "$0")" && pwd)"
okf_scripts="${OKF_SCRIPTS:-$script_dir}"
if [ ! -d "$okf_scripts" ]; then
  echo "error: OKF scripts directory does not exist: $okf_scripts" >&2
  echo "  set OKF_SCRIPTS to the directory containing the canonical scripts" >&2
  exit 2
fi

echo "==> bundle root : $okf_root"
echo "==> scripts dir : $okf_scripts"
echo

# Step 1: ensure all six canonical scripts are present and up-to-date.
echo "==> step 1: refresh canonical scripts"
for s in validate.js lint-frontmatter.js check-index-sync.js check-orphans.js \
         linkify-prose.js author-concepts.js; do
  src="$okf_scripts/$s"
  if [ ! -f "$src" ]; then
    echo "    ERROR: missing canonical script: $s" >&2
    exit 2
  fi
  dst="$okf_root/scripts/$s"
  mkdir -p "$(dirname "$dst")"
  if ! cmp -s "$src" "$dst" 2>/dev/null; then
    cp "$src" "$dst"
    chmod +x "$dst"
    echo "    refreshed: $s"
  else
    echo "    up-to-date: $s"
  fi
done

# Step 2: run all four conformance validators.
echo
echo "==> step 2: run validators"
fail=0
for s in validate lint-frontmatter check-index-sync check-orphans; do
  echo "    $s ..."
  if ! node "$okf_root/scripts/$s.js" "$okf_root" --strict; then
    echo "    FAIL: $s" >&2
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  echo "==> one or more validators failed" >&2
  exit 1
fi

# Step 3: summary.
echo
echo "==> summary"
echo "    bundle root:  $okf_root"
echo "    scripts:      $(ls "$okf_root/scripts" | wc -l) files"
echo "    concepts:     $(find "$okf_root" -name '*.md' \
                       -not -name 'index.md' -not -name 'log.md' | wc -l)"
echo
echo "OKF sync validated."