#!/bin/sh

# Detect database provider from environment
DB_PROVIDER="${DATABASE_PROVIDER:-sqlite}"
echo "Database provider: $DB_PROVIDER"

# Capture DB settings provided via the container runtime environment (compose /
# docker run -e) before the persisted env file is sourced. The image bakes
# sqlite placeholder URLs into ENV; those are not user intent, so ignore them.
RUNTIME_DATABASE_PROVIDER="$DATABASE_PROVIDER"
RUNTIME_DATABASE_URL="$DATABASE_URL"
RUNTIME_LOG_DATABASE_URL="$LOG_DATABASE_URL"
[ "$RUNTIME_DATABASE_URL" = "file:/db/baby-tracker.db" ] && RUNTIME_DATABASE_URL=""
[ "$RUNTIME_LOG_DATABASE_URL" = "file:/db/baby-tracker-logs.db" ] && RUNTIME_LOG_DATABASE_URL=""

# SQLite-specific setup: create directories and symlinks
if [ "$DB_PROVIDER" = "sqlite" ]; then
  # Ensure the database directory exists
  mkdir -p /db

  # Create a symbolic link from /app/db to /db to ensure both paths point to the same location
  mkdir -p /app
  ln -sf /db /app/db

  # Set default DATABASE_URL if not provided
  if [ -z "$DATABASE_URL" ] || [ "$DATABASE_URL" = "file:/db/baby-tracker.db" ]; then
    export DATABASE_URL="file:/db/baby-tracker.db"
  fi
  if [ -z "$LOG_DATABASE_URL" ] || [ "$LOG_DATABASE_URL" = "file:/db/baby-tracker-logs.db" ]; then
    export LOG_DATABASE_URL="file:/db/baby-tracker-logs.db"
  fi
fi

# Set up timezone for Alpine Linux
if [ -n "$TZ" ]; then
  # Create the timezone file if it doesn't exist
  echo "$TZ" > /etc/TZ
  # Create a symlink to the zoneinfo file if it exists
  if [ -f "/usr/share/zoneinfo/$TZ" ]; then
    ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime
  fi
fi

# Privilege model: this script starts as root only for TZ setup, handing the
# writable paths to "node", and starting crond. Everything that reads or runs
# files the app can write (the env file, prisma schema, generated clients)
# runs as node, so a compromised app process cannot get code run as root.
# The env file is parsed as KEY=value lines, never sourced (sourcing executes it).
if [ "$(id -u)" = "0" ]; then
  AS_NODE="su-exec node"
  # find ! -user keeps restarts fast on large photo volumes.
  for dir in /db /app/env /app/Files /app/logs /app/prisma /app/node_modules/.prisma /app/.next/cache; do
    [ -d "$dir" ] && find "$dir" ! -user node -exec chown node:node {} +
  done
else
  AS_NODE=""
fi

load_env_file() {
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    # Allowlist: only the app's own settings. The file is node-writable and is
    # loaded into a root shell (crond, su-exec), so loader and interpreter
    # variables (PATH, LD_*, NODE_OPTIONS, npm_config_*, ...) must never pass.
    case "$key" in
      DATABASE_PROVIDER|DATABASE_URL|LOG_DATABASE_URL|ENABLE_LOG|NODE_ENV|PORT|TZ|\
      AUTH_LIFE|REFRESH_TOKEN_LIFE|IDLE_TIME|APP_VERSION|COOKIE_SECURE|ENC_HASH|JWT_SECRET|\
      ENABLE_NOTIFICATIONS|NOTIFICATION_CRON_SECRET|APP_URL|ROOT_DOMAIN|DEPLOYMENT_MODE|\
      ENABLE_ACCOUNTS|ALLOW_ACCOUNT_REGISTRATION|BETA|ADMIN_EMAIL|ACCOUNTS_EMAIL|\
      NO_REPLY_EMAIL|PAYMENTS_EMAIL|ANDROID_CERT_SHA256|APPLE_TEAM_ID|\
      NEXT_PUBLIC_*|STRIPE_*|APNS_*|FCM_*|VAPID_*|HOOKS_*|ST_GUARDIAN_*) ;;
      *) continue ;;
    esac
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    export "$key=$val"
  done < "$1"
}

# Ensure all required environment variables exist with defaults
echo "Ensuring environment defaults..."
$AS_NODE npm run env:ensure -- docker /app/env/.env

# Load the env file so vars are available in this shell session
ENV_FILE="/app/env/.env"
load_env_file "$ENV_FILE"

# Runtime container env takes precedence over the persisted env file for DB
# settings (issue #171): a stale or baked sqlite env file must not clobber a
# PostgreSQL deployment.
[ -n "$RUNTIME_DATABASE_PROVIDER" ] && export DATABASE_PROVIDER="$RUNTIME_DATABASE_PROVIDER"
[ -n "$RUNTIME_DATABASE_URL" ] && export DATABASE_URL="$RUNTIME_DATABASE_URL"
[ -n "$RUNTIME_LOG_DATABASE_URL" ] && export LOG_DATABASE_URL="$RUNTIME_LOG_DATABASE_URL"

# Fail fast on a provider/URL mismatch instead of silently falling back to an
# empty SQLite database (URLs are not echoed: they may contain credentials).
if [ "$DB_PROVIDER" = "postgresql" ]; then
  case "$DATABASE_URL" in
    postgres://*|postgresql://*) ;;
    *)
      echo "ERROR: DATABASE_PROVIDER is postgresql but DATABASE_URL is empty or does not start with postgresql://"
      echo "Set DATABASE_URL to your PostgreSQL connection string (see docker-compose.postgres.yml)."
      exit 1
      ;;
  esac
  case "$LOG_DATABASE_URL" in
    postgres://*|postgresql://*) ;;
    *)
      echo "ERROR: DATABASE_PROVIDER is postgresql but LOG_DATABASE_URL is empty or does not start with postgresql://"
      echo "Set LOG_DATABASE_URL to your PostgreSQL connection string (see docker-compose.postgres.yml)."
      exit 1
      ;;
  esac
fi

echo "Generating Prisma clients..."
$AS_NODE npm run prisma:generate
$AS_NODE npm run prisma:generate:log

if [ "$DB_PROVIDER" = "postgresql" ]; then
  # PostgreSQL: wait for database to be ready, then push schema
  echo "Waiting for PostgreSQL to be ready..."
  # Extract host and port from DATABASE_URL for pg_isready
  PG_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
  PG_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  PG_PORT="${PG_PORT:-5432}"

  if [ -n "$PG_HOST" ]; then
    RETRIES=30
    until pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null || [ "$RETRIES" -eq 0 ]; do
      echo "Waiting for PostgreSQL at $PG_HOST:$PG_PORT... ($RETRIES retries left)"
      RETRIES=$((RETRIES - 1))
      sleep 1
    done

    if [ "$RETRIES" -eq 0 ]; then
      echo "WARNING: PostgreSQL may not be ready, attempting to continue..."
    else
      echo "PostgreSQL is ready."
    fi
  fi

  echo "Pushing database schema to PostgreSQL..."
  $AS_NODE npx prisma db push --accept-data-loss

  echo "Pushing log database schema to PostgreSQL..."
  $AS_NODE npx prisma db push --config prisma/log.config.ts --accept-data-loss
else
  # SQLite: use migration deploy (existing behavior)
  echo "Running database migrations..."
  $AS_NODE npx prisma migrate deploy

  echo "Creating log database schema..."
  $AS_NODE npx prisma db push --config prisma/log.config.ts --accept-data-loss
fi

echo "Converting legacy SQLite datetime values..."
# Idempotent: Prisma 6 stored DateTimes as integer ms, Prisma 7's adapter uses text
$AS_NODE node scripts/convert-sqlite-datetimes.js

echo "Seeding database..."
# Seed script has built-in checks for all entities (families, caretakers, settings, units)
# It only creates/updates what doesn't exist, so it's safe to run on every startup
$AS_NODE npx prisma db seed

echo "Converting legacy solids feeds to food logs..."
# Idempotent: converted feeds are deleted, so reruns find nothing to do
$AS_NODE node scripts/convert-solids-feeds.js

# Notification setup (only if enabled)
if [ "$ENABLE_NOTIFICATIONS" = "true" ]; then
  echo ""
  echo "=== Notification Setup ==="
  echo "Notifications are enabled, setting up notification infrastructure..."

  echo "VAPID keys are generated automatically in the database during seeding."
  echo "✓ NOTIFICATION_CRON_SECRET handled by env:ensure script"

  # Check APP_URL or ROOT_DOMAIN
  APP_URL_CHECK=$(grep -E "^APP_URL=" "$ENV_FILE" 2>/dev/null | cut -d '=' -f2 | tr -d '"')
  ROOT_DOMAIN_CHECK=$(grep -E "^ROOT_DOMAIN=" "$ENV_FILE" 2>/dev/null | cut -d '=' -f2 | tr -d '"')
  if [ -z "$APP_URL_CHECK" ] && [ -z "$ROOT_DOMAIN_CHECK" ]; then
    echo "⚠ Warning: Neither APP_URL nor ROOT_DOMAIN is set"
    echo "  Cron job will default to http://localhost:3000"
  else
    echo "✓ API URL configuration found"
  fi

  # Setup cron job
  echo "Setting up notification cron job..."
  # crond runs as root; the job itself runs as node (CRON_RUN_AS).
  [ -n "$AS_NODE" ] && export CRON_RUN_AS=node
  # This step runs as root through tsx, which caches compiled code under
  # $TMPDIR. A fresh root-only directory means node can't pre-seed that cache.
  CRON_SETUP_TMP="$(mktemp -d)"
  TMPDIR="$CRON_SETUP_TMP" npm run notification:cron:setup
  CRON_SETUP_STATUS=$?
  rm -rf "$CRON_SETUP_TMP"
  if [ $CRON_SETUP_STATUS -eq 0 ]; then
    echo "✓ Cron job setup completed"
  else
    echo "⚠ Warning: Cron job setup failed, but continuing..."
  fi

  # Start cron daemon in background
  echo "Starting cron daemon..."
  crond -f -d 8 &
  CRON_PID=$!
  if [ $? -eq 0 ]; then
    echo "✓ Cron daemon started (PID: $CRON_PID)"
  else
    echo "⚠ Warning: Failed to start cron daemon"
  fi

  echo "=== Notification Setup Complete ==="
  echo ""
else
  echo "Notifications are disabled (ENABLE_NOTIFICATIONS != true)"
fi

# Drop root before starting the app.
if [ -n "$AS_NODE" ]; then
  echo "Starting application as user node..."
  exec su-exec node "$@"
fi

echo "Starting application..."
exec "$@"
