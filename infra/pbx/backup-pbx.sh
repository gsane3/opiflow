#!/usr/bin/env bash
# =============================================================================
# backup-pbx.sh — daily backup of the Asterisk box config (runs ON the box).
# =============================================================================
# Captures everything needed to rebuild call routing: the full /etc/asterisk
# config (base + generated includes), the redacted env, and a sounds inventory.
# Rotates locally and (optionally) rsyncs OFF the box so a total host loss can't
# also lose the backup.
#
# Install (on the box, as root):
#   install -m700 backup-pbx.sh /opt/opiflow/backup-pbx.sh
#   ( crontab -l 2>/dev/null; echo '17 3 * * * /opt/opiflow/backup-pbx.sh >> /var/log/opiflow-backup.log 2>&1' ) | crontab -
#
# Off-box copy (recommended): set BACKUP_RSYNC_DEST to e.g.
#   user@host:/backups/opiflow-pbx/   or an rclone remote you wrap here.
# =============================================================================
set -euo pipefail

DEST_DIR="${BACKUP_DEST_DIR:-/var/backups/opiflow-pbx}"
KEEP="${BACKUP_KEEP:-14}"                 # how many daily archives to retain
RSYNC_DEST="${BACKUP_RSYNC_DEST:-}"       # optional off-box destination
TS="$(date -u +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$DEST_DIR"

# 1) Asterisk config — the whole dir (base + generated). This is the crown jewel.
mkdir -p "$WORK/asterisk"
cp -a /etc/asterisk/. "$WORK/asterisk/" 2>/dev/null || true

# 2) Redacted env — keys present, secret VALUES stripped (never back up plaintext secrets).
if [ -f /etc/opiflow/sip.env ]; then
  sed -E 's/^([A-Za-z0-9_]+)=.*/\1=<REDACTED>/' /etc/opiflow/sip.env > "$WORK/sip.env.redacted"
fi

# 3) Sounds inventory — the per-business disclosure WAVs are regenerated from the DB,
#    so we record only their NAMES/sizes (not the audio) for verification.
ls -la /var/lib/asterisk/sounds/ 2>/dev/null > "$WORK/sounds.inventory.txt" || true

# 4) Provisioner + version stamps for the runbook.
cp -a /opt/opiflow/provision-asterisk.py "$WORK/" 2>/dev/null || true
{ asterisk -V 2>/dev/null || true; uname -a; } > "$WORK/versions.txt" || true
crontab -l 2>/dev/null > "$WORK/root.crontab" || true

# 5) Bundle + rotate.
ARCHIVE="$DEST_DIR/asterisk-${TS}.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" .
chmod 600 "$ARCHIVE"
echo "[backup] wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Keep only the newest $KEEP archives.
ls -1t "$DEST_DIR"/asterisk-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

# 6) Off-box copy (optional but strongly recommended).
if [ -n "$RSYNC_DEST" ]; then
  rsync -az --delete "$DEST_DIR"/ "$RSYNC_DEST" && echo "[backup] synced to $RSYNC_DEST"
fi
