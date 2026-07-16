#!/bin/bash
set -euo pipefail

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Not inside a Git worktree."
  exit 1
}
[ "$(git rev-parse --is-shallow-repository)" = "false" ] || {
  echo "Secret-history verification requires a complete, non-shallow clone."
  exit 1
}

sensitive_paths=(
  '.env'
  '.env.local'
  '.env.production'
  'odoo.local.env'
  '*.local.env'
)

tracked_sensitive=$(git ls-files -- "${sensitive_paths[@]}")
if [ -n "$tracked_sensitive" ]; then
  echo "Sensitive environment files are tracked:"
  echo "$tracked_sensitive"
  exit 1
fi

history_sensitive=$(git log --all --format= --name-only -- "${sensitive_paths[@]}" \
  | sed '/^$/d' | sort -u)
if [ -n "$history_sensitive" ]; then
  echo "Sensitive environment files remain in reachable repository history:"
  echo "$history_sensitive"
  exit 1
fi

if git grep -l -I -E -- \
  '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}' \
  -- . ':(exclude)scripts/verify-repository-secrets.sh'; then
  echo "A high-confidence secret signature was found in tracked content."
  exit 1
fi

history_signature_paths=$(git grep -l -I -E -e \
  '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}' \
  $(git rev-list --all) -- . ':(exclude)scripts/verify-repository-secrets.sh' 2>/dev/null || true)
if [ -n "$history_signature_paths" ]; then
  echo "A high-confidence secret signature remains in reachable history at:"
  printf '%s\n' "$history_signature_paths"
  exit 1
fi

echo "Tracked files and reachable history contain no prohibited secret-file paths or high-confidence key signatures."
