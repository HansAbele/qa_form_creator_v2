#!/bin/bash

validate_secure_operator_file() {
  local file_path="$1"
  local label="${2:-file}"

  if [ ! -f "$file_path" ] || [ -L "$file_path" ] || [ ! -s "$file_path" ]; then
    echo "$label must be a non-empty regular non-symlink file: $file_path" >&2
    return 1
  fi
  if [ "$(stat -c '%a' "$file_path")" != "600" ]; then
    echo "$label must have mode 600: $file_path" >&2
    return 1
  fi
  if [ "$(stat -c '%u' "$file_path")" != "$(id -u)" ]; then
    echo "$label must be owned by the current operator: $file_path" >&2
    return 1
  fi
}
