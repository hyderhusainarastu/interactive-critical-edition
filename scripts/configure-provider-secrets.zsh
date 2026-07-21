#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."

env_file="apps/worker/.env"

if ! git check-ignore -q "$env_file"; then
  print -u2 -- "Refusing to write: ${env_file} is not ignored by Git."
  exit 1
fi

touch "$env_file"
chmod 600 "$env_file"

upsert_secret() {
  local name="$1"
  local value
  local temporary_file

  print -n -- "Paste ${name} (hidden; blank skips it): "
  IFS= read -r -s value
  print

  if [[ -z "$value" ]]; then
    print "Skipped ${name}."
    return
  fi

  temporary_file="$(mktemp "${env_file}.XXXXXX")"
  /usr/bin/grep -v "^${name}=" "$env_file" > "$temporary_file" || true
  print -r -- "${name}=${value}" >> "$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$env_file"
  unset value
}

upsert_secret TAVILY_API_KEY
upsert_secret YOUTUBE_API_KEY
upsert_secret BLOGGER_API_KEY
upsert_secret MASTODON_ACCESS_TOKEN
upsert_secret BLUESKY_APP_PASSWORD
upsert_secret MASTODON_INSTANCE_URL
upsert_secret BLUESKY_IDENTIFIER
upsert_secret BLOGGER_BLOG_IDS

print "Saved provider configuration in ignored ${env_file}."
