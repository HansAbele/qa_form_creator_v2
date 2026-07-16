#!/bin/bash

# Require a stable single-line passphrase. OpenSSL's `-pass file:` reads only
# the first line, so accepting line-wrapped material would make restore behavior
# depend on how a secret manager happened to wrap the same Base64 value.
validate_backup_key_material() {
  local key_file="$1"
  local encoded_key
  local decoded_bytes
  local logical_lines

  command -v openssl >/dev/null 2>&1 || {
    echo "openssl is required to validate the backup encryption key." >&2
    return 1
  }

  logical_lines=$(awk 'END { print NR }' "$key_file") || return 1
  if [ "$logical_lines" != "1" ]; then
    echo "Backup encryption key must contain exactly one Base64 line." >&2
    return 1
  fi
  encoded_key=$(awk 'NR == 1 { printf "%s", $0 }' "$key_file") || return 1

  if [[ "$encoded_key" =~ ^[A-Za-z0-9+/]{86}==$ ]]; then
    decoded_bytes=64
  elif [[ "$encoded_key" =~ ^[A-Za-z0-9+/]{64}$ ]]; then
    decoded_bytes=48
    echo "WARNING: legacy 48-byte backup passphrase accepted; rotate after old backups are retired." >&2
  else
    echo "Backup encryption key must be one canonical Base64 line encoding 64 random bytes." >&2
    return 1
  fi

  local actual_decoded_bytes
  actual_decoded_bytes=$(printf '%s' "$encoded_key" |
    openssl base64 -d -A 2>/dev/null |
    wc -c | tr -d '[:space:]') || return 1
  if [ "$actual_decoded_bytes" != "$decoded_bytes" ]; then
    echo "Backup encryption key has invalid Base64 encoding." >&2
    return 1
  fi
}
