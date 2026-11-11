#!/bin/sh

# Script to trigger notification cron check via API
# This script is called by system cron every minute

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load environment variables from .env file if it exists. Parsed as KEY=value
# lines, never sourced: sourcing would execute the file.
if [ -f "$PROJECT_DIR/.env" ]; then
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
  done < "$PROJECT_DIR/.env"
fi

# Check if cron secret is set
if [ -z "$NOTIFICATION_CRON_SECRET" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S'): [Cron] ERROR: NOTIFICATION_CRON_SECRET is not set" >&2
  exit 1
fi

# Determine API URL
if [ -n "$APP_URL" ]; then
  API_URL="$APP_URL"
elif [ -n "$ROOT_DOMAIN" ]; then
  # Determine protocol based on environment
  if [ "$NODE_ENV" = "production" ]; then
    PROTOCOL="https"
  else
    PROTOCOL="http"
  fi
  API_URL="$PROTOCOL://$ROOT_DOMAIN"
else
  # Default to localhost for development
  API_URL="http://localhost:3000"
fi

# Check if notifications are enabled via lightweight DB-backed endpoint
ENABLED_RESPONSE=$(curl -s --max-time 5 "$API_URL/api/notifications/cron-enabled" 2>/dev/null)
ENABLED=$(echo "$ENABLED_RESPONSE" | grep -o '"enabled":true')
if [ -z "$ENABLED" ]; then
  exit 0  # Silently exit — notifications disabled or app unreachable
fi

echo "$(date '+%Y-%m-%d %H:%M:%S'): [Cron] Starting notification check..."

# Construct full endpoint URL
ENDPOINT_URL="$API_URL/api/notifications/cron"

echo "$(date '+%Y-%m-%d %H:%M:%S'): [Cron] Calling API endpoint: $ENDPOINT_URL"

# Make the API call
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $NOTIFICATION_CRON_SECRET" \
  --max-time 30 \
  --connect-timeout 10)

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
# Extract response body (all but last line)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

# Check if request was successful
if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  # Success - log to stdout for debugging
  echo "$(date '+%Y-%m-%d %H:%M:%S'): [Cron] ✓ Success (HTTP $HTTP_CODE)"
  echo "$(date '+%Y-%m-%d %H:%M:%S'): [Cron] Response: $RESPONSE_BODY"
  exit 0
else
  # Error - log to stderr
  echo "$(date '+%Y-%m-%d %H:%M:%S'): [Cron] ✗ ERROR: API call failed with HTTP $HTTP_CODE" >&2
  echo "$(date '+%Y-%m-%d %H:%M:%S'): [Cron] Response: $RESPONSE_BODY" >&2
  exit 1
fi
