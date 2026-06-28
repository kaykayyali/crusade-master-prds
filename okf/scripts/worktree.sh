#!/usr/bin/env bash
# OKF worktree management.
#
# The OKF bundle work must happen in a git worktree, not in the main
# checkout of the source repo. Reasons:
#
#   1. The source repo's main checkout holds source PRDs (or whatever
#      the bundle mirrors). Mixing OKF edits with source-PRD edits in
#      the same working tree makes rebases and reviews painful.
#   2. The OKF bundle has its own branch (e.g. feature/okf-bundle).
#      Living on that branch via a worktree means the main checkout can
#      stay on main (or any other source branch) without switching.
#   3. The worktree is the single, well-known location for all OKF
#      edits — easy to point scripts at, easy to clean up.
#
# Usage:
#   worktree.sh create <repo> <branch> [<path>]
#   worktree.sh list   <repo>
#   worktree.sh remove <repo> <path>
#   worktree.sh path   <repo> <branch>     # print worktree path for branch
#
#   <repo>   : path to the source repo (or a worktree inside it)
#   <branch> : branch name for the OKF bundle (e.g. feature/okf-bundle)
#   <path>   : absolute path where the worktree should live. Defaults
#              to <parent-of-repo>/<repo-basename>-okf/
#
# Conventions:
#   * create: if the branch doesn't exist, it's created from the repo's
#             HEAD. If the worktree path already exists and is a
#             worktree, the script reuses it.
#   * remove: refuses to remove the main checkout. Use `git worktree
#             remove` semantics.
#
# Exit codes:
#   0 : success
#   2 : usage error
#   3 : git error (branch in use elsewhere, dirty tree, etc.)

set -euo pipefail

cmd="${1:-}"
shift || true

usage() {
  cat <<EOF
usage:
  worktree.sh create <repo> <branch> [<path>]
  worktree.sh list   <repo>
  worktree.sh remove <repo> <path>
  worktree.sh path   <repo> <branch>

The OKF bundle should be authored in a git worktree, not in the main
checkout of the source repo. This script manages that worktree.
EOF
}

die_usage() {
  usage >&2
  exit 2
}

default_worktree_path() {
  local repo="$1"
  local branch="$2"
  local parent
  parent="$(cd "$(dirname "$repo")" && pwd)"
  local base
  base="$(basename "$repo")"
  # Strip trailing -master/-main/-prds for nicer default names.
  base="${base%-master}"
  base="${base%-main}"
  base="${base%-prds}"
  echo "$parent/${base}-okf"
}

ensure_clean() {
  local repo="$1"
  if ! git -C "$repo" diff --quiet HEAD 2>/dev/null; then
    echo "error: $repo has uncommitted changes" >&2
    exit 3
  fi
}

cmd_create() {
  local repo="${1:-}"
  local branch="${2:-}"
  local path="${3:-}"
  if [ -z "$repo" ] || [ -z "$branch" ]; then
    usage >&2
    exit 2
  fi
  if [ ! -d "$repo" ]; then
    echo "error: repo is not a directory: $repo" >&2
    exit 2
  fi
  if [ -z "$path" ]; then
    path="$(default_worktree_path "$repo" "$branch")"
  fi

  ensure_clean "$repo"

  # Branch exists?
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "==> branch '$branch' exists; adding worktree at $path"
  else
    echo "==> creating branch '$branch' from HEAD; adding worktree at $path"
    git -C "$repo" branch "$branch" HEAD
  fi

  # Worktree already at path?
  if git -C "$repo" worktree list --porcelain | grep -q "^worktree $path$"; then
    echo "    worktree already exists; reusing"
    git -C "$repo" worktree list
    exit 0
  fi

  git -C "$repo" worktree add "$path" "$branch"
  echo
  echo "Worktree ready:"
  echo "  path:   $path"
  echo "  branch: $branch"
  echo
  echo "Run OKF work from there. The main checkout stays on its own branch."
}

cmd_list() {
  local repo="${1:-}"
  if [ -z "$repo" ]; then
    usage >&2
    exit 2
  fi
  git -C "$repo" worktree list
}

cmd_remove() {
  local repo="${1:-}"
  local path="${2:-}"
  if [ -z "$repo" ] || [ -z "$path" ]; then
    usage >&2
    exit 2
  fi
  # Refuse to remove the main checkout.
  local main_path
  main_path="$(git -C "$repo" worktree list --porcelain | head -1 | sed 's/^worktree //')"
  if [ "$path" = "$main_path" ]; then
    echo "error: refusing to remove the main checkout ($path)" >&2
    exit 3
  fi
  ensure_clean "$repo"
  git -C "$repo" worktree remove "$path"
  echo "removed worktree: $path"
}

cmd_path() {
  local repo="${1:-}"
  local branch="${2:-}"
  if [ -z "$repo" ] || [ -z "$branch" ]; then
    usage >&2
    exit 2
  fi
  git -C "$repo" worktree list --porcelain \
    | awk -v br="$branch" '
        /^worktree / { p = substr($0, 10) }
        /^branch /   { if ($2 == "refs/heads/" br) { print p; exit 0 } }
        END          { exit 1 }
      '
}

case "$cmd" in
  create) cmd_create "$@" ;;
  list)   cmd_list "$@" ;;
  remove) cmd_remove "$@" ;;
  path)   cmd_path "$@" ;;
  -h|--help) usage; exit 0 ;;
  "")        die_usage ;;
  *)         echo "error: unknown command: $cmd" >&2; usage >&2; exit 2 ;;
esac