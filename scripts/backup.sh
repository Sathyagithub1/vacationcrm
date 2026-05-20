#!/bin/bash
set -euo pipefail

BACKUP_DIR="/backups/postgres"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/holiday_delight_crm_${TIMESTAMP}.sql.gz"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Create compressed backup
echo "Creating backup: ${BACKUP_FILE}"
docker compose exec -T postgres pg_dump \
  -U postgres \
  -d holiday_delight_crm \
  | gzip > "$BACKUP_FILE"

echo "Backup created successfully: ${BACKUP_FILE}"

# Delete backups older than 30 days
echo "Cleaning up backups older than 30 days..."
find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +30 -delete

echo "Backup complete."
