#!/bin/bash
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  echo "Example: $0 /backups/postgres/holiday_delight_crm_20260520_120000.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "Restoring from: ${BACKUP_FILE}"
echo "WARNING: This will overwrite the current database. Press Ctrl+C to cancel."
sleep 5

gunzip -c "$BACKUP_FILE" | docker compose exec -T postgres psql \
  -U postgres \
  -d holiday_delight_crm

echo "Restore complete."
