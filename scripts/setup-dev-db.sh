#!/usr/bin/env bash
# =====================================================================
# Initialise the local Cloudflare D1 (SQLite) database for development.
# =====================================================================
# Why this script exists:
#   `wrangler d1 migrations apply --local` cannot rebuild this database from
#   scratch. The migrations/ directory contains files whose numeric prefixes do
#   not match the order in which they must run (several early "feature" files
#   depend on tables/columns created by higher-numbered migrations, and are
#   themselves superseded later). This script instead:
#     1. applies the replayable subset, in the verified order listed in
#        scripts/dev-migration-order.txt;
#     2. adds the few objects that only live in the non-replayable migrations
#        but are still used by the app (scripts/dev-schema-patch.sql and
#        scripts/dev-schema-columns.sql);
#     3. seeds a handful of test accounts (scripts/dev-seed.sql).
#
# It is idempotent: if the database already has users it exits immediately.
# Pass --force to rebuild from scratch.
set -euo pipefail

cd "$(dirname "$0")/.."
export WRANGLER_SEND_METRICS=false CI=1
DB_NAME="animato-production"
WR() { npx --yes wrangler "$@"; }

FORCE="${1:-}"

if [ "$FORCE" != "--force" ]; then
  cnt="$(WR d1 execute "$DB_NAME" --local --json --command "SELECT count(*) AS c FROM users;" 2>/dev/null \
        | jq -r '.[0].results[0].c' 2>/dev/null || true)"
  if [ -n "${cnt:-}" ] && [ "$cnt" -ge 1 ] 2>/dev/null; then
    echo "Local dev DB already initialised (users=$cnt) — skipping. Use --force to rebuild."
    exit 0
  fi
fi

echo ">> Resetting local D1 state"
rm -rf .wrangler/state/v3/d1

echo ">> Applying migrations in verified order"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  out="$(WR d1 execute "$DB_NAME" --local --file "migrations/$f" 2>&1)" || true
  if ! printf '%s' "$out" | grep -qiE "executed successfully"; then
    echo "FATAL: migration failed: $f"
    printf '%s\n' "$out" | grep -iE "error|no such|✘" | head -3
    exit 1
  fi
done < scripts/dev-migration-order.txt

echo ">> Applying schema patch (missing tables)"
WR d1 execute "$DB_NAME" --local --file scripts/dev-schema-patch.sql >/dev/null

echo ">> Applying schema patch (missing columns, tolerant)"
grep -iE '^ALTER TABLE' scripts/dev-schema-columns.sql | while IFS= read -r stmt; do
  WR d1 execute "$DB_NAME" --local --command "$stmt" >/dev/null 2>&1 \
    && echo "   ok: $stmt" \
    || echo "   skip (already present): $stmt"
done

echo ">> Seeding test accounts"
WR d1 execute "$DB_NAME" --local --file scripts/dev-seed.sql >/dev/null

users="$(WR d1 execute "$DB_NAME" --local --json --command "SELECT count(*) AS c FROM users;" \
        | jq -r '.[0].results[0].c')"
tables="$(WR d1 execute "$DB_NAME" --local --json --command "SELECT count(*) AS c FROM sqlite_master WHERE type='table';" \
        | jq -r '.[0].results[0].c')"
echo ">> Done. tables=$tables users=$users"
echo ">> Login with admin@animato.be / admin123"
