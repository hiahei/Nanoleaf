#!/bin/zsh
set -euo pipefail

APP_ROOT="${0:A:h}"
PID_FILE="$APP_ROOT/data/localtex.pid"

if [[ ! -f "$PID_FILE" ]]; then
  print "No LocalTeX service created by the launcher was found."
  exit 0
fi

SERVICE_ID="$(tr -d '[:space:]' < "$PID_FILE")"
if [[ -z "$SERVICE_ID" || "$SERVICE_ID" != <-> ]]; then
  rm -f "$PID_FILE"
  print "Removed invalid LocalTeX PID file."
  exit 0
fi

if ! kill -0 "$SERVICE_ID" 2>/dev/null; then
  rm -f "$PID_FILE"
  print "The LocalTeX service is already stopped."
  exit 0
fi

COMMAND_LINE="$(ps -p "$SERVICE_ID" -o command= 2>/dev/null || true)"
if [[ "$COMMAND_LINE" != *"server.js"* ]]; then
  print -u2 "PID $SERVICE_ID is not the LocalTeX server.js process. Refusing to stop it."
  exit 1
fi

kill -TERM "$SERVICE_ID"
for _ in {1..25}; do
  if ! kill -0 "$SERVICE_ID" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

rm -f "$PID_FILE"
print "The LocalTeX service has stopped."
