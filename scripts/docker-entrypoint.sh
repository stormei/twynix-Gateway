#!/bin/sh
set -eu

hash_file="${ADMIN_PASSWORD_HASH_FILE:-/data/admin-password-hash}"

mkdir -p "$(dirname "$hash_file")"

generate_hash() {
  node --input-type=module -e "
    import crypto from 'crypto';
    const password = process.env.ADMIN_PASSWORD || process.argv[1] || '';
    if (!password) process.exit(2);
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    console.log('scrypt$' + salt + '$' + derived);
  " "$1"
}

if [ -s "$hash_file" ]; then
  export ADMIN_PASSWORD_HASH="$(cat "$hash_file")"
elif [ -n "${ADMIN_PASSWORD_HASH:-}" ]; then
  printf '%s\n' "$ADMIN_PASSWORD_HASH" > "$hash_file"
  chmod 600 "$hash_file" 2>/dev/null || true
elif [ -n "${ADMIN_PASSWORD:-}" ]; then
  ADMIN_PASSWORD_HASH="$(generate_hash "$ADMIN_PASSWORD")"
  export ADMIN_PASSWORD_HASH
  printf '%s\n' "$ADMIN_PASSWORD_HASH" > "$hash_file"
  chmod 600 "$hash_file" 2>/dev/null || true
  echo "Generated admin password hash at $hash_file from ADMIN_PASSWORD."
else
  ADMIN_PASSWORD="$(node --input-type=module -e "import crypto from 'crypto'; console.log(crypto.randomBytes(18).toString('base64url'))")"
  export ADMIN_PASSWORD
  ADMIN_PASSWORD_HASH="$(generate_hash "$ADMIN_PASSWORD")"
  export ADMIN_PASSWORD_HASH
  printf '%s\n' "$ADMIN_PASSWORD_HASH" > "$hash_file"
  chmod 600 "$hash_file" 2>/dev/null || true
  echo "Generated one-time gateway admin password: $ADMIN_PASSWORD"
  echo "Password hash stored at $hash_file. Save this password now or reset by deleting the hash file."
fi

unset ADMIN_PASSWORD

exec "$@"
