#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secure-file.sh
source "$SCRIPT_DIR/lib/secure-file.sh"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/to/.backup-key" >&2
  exit 1
fi

key_file="$1"
validate_secure_operator_file "$key_file" "legacy backup encryption key" || exit 1
mapfile -t key_lines < "$key_file"

if [ "${#key_lines[@]}" -ne 2 ] ||
   [[ ! "${key_lines[0]}" =~ ^[A-Za-z0-9+/]{64}$ ]] ||
   [[ ! "${key_lines[1]}" =~ ^[A-Za-z0-9+/]{22}==$ ]] ||
   [ "$(printf '%s%s' "${key_lines[0]}" "${key_lines[1]}" |
      openssl base64 -d -A 2>/dev/null | wc -c | tr -d '[:space:]')" != "64" ]; then
  echo "Key is not the legacy two-line output of openssl rand -base64 64." >&2
  exit 1
fi

# Historical `openssl enc -pass file:` operations used only this first line.
# Keeping it verbatim preserves every existing backup while removing ambiguity.
key_temp=$(mktemp "$(dirname "$key_file")/.backup-key-migration.XXXXXX")
cleanup() { rm -f "$key_temp"; }
trap cleanup EXIT
printf '%s' "${key_lines[0]}" > "$key_temp"
chmod 600 "$key_temp"
chown --reference="$key_file" "$key_temp"
mv -f "$key_temp" "$key_file"
key_temp=""

echo "Legacy key normalized to its original one-line OpenSSL passphrase."
echo "Existing backups remain decryptable; plan a new 64-byte key after their retention expires."
