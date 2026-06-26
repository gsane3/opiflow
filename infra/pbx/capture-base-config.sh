#!/usr/bin/env bash
# =============================================================================
# capture-base-config.sh — one-command read-only dump of the LIVE Asterisk base
# config into git. Run from YOUR machine (not the box). Does NOT modify the box.
# =============================================================================
# This automates the manual scp+redact step from RESTORE_RUNBOOK.md so the
# hand-applied base config (the #1 single point of failure) lands in the repo and
# stays reproducible. The trunk password is auto-redacted before anything is saved.
#
# Usage:
#   ./infra/pbx/capture-base-config.sh                 # uses the defaults below
#   PBX_HOST=46.224.138.115 PBX_KEY=~/.ssh/yorgos_pbx_vps_600 ./infra/pbx/capture-base-config.sh
#
# After it runs: review `git diff infra/pbx/asterisk/`, confirm NO secrets slipped
# through, then commit. The *.base.conf / http.conf templates already in git become
# the authoritative, verified copies.
# =============================================================================
set -euo pipefail

PBX_HOST="${PBX_HOST:-46.224.138.115}"
PBX_USER="${PBX_USER:-root}"
PBX_KEY="${PBX_KEY:-$HOME/.ssh/yorgos_pbx_vps_600}"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/asterisk/captured"

mkdir -p "$OUT_DIR"
SSH=(ssh -i "$PBX_KEY" -o StrictHostKeyChecking=accept-new "${PBX_USER}@${PBX_HOST}")

echo "[capture] pulling /etc/asterisk/*.conf from ${PBX_USER}@${PBX_HOST} (read-only)…"

# Pull each base .conf (NOT the generated includes — those are recreated from the DB).
for f in pjsip.conf extensions.conf http.conf rtp.conf voicemail.conf logger.conf modules.conf; do
  if "${SSH[@]}" "test -f /etc/asterisk/$f"; then
    "${SSH[@]}" "cat /etc/asterisk/$f" > "$OUT_DIR/$f" && echo "  ✓ $f"
  fi
done

# Redact obvious secrets in-place (PJSIP auth passwords, any *secret*/*password* line).
# The pattern keeps the key visible but blanks the value, so the structure stays intact.
for f in "$OUT_DIR"/*.conf; do
  [ -f "$f" ] || continue
  sed -i -E \
    -e 's/^([[:space:]]*password[[:space:]]*=[[:space:]]*).*/\1<REDACTED>/I' \
    -e 's/^([[:space:]]*secret[[:space:]]*=[[:space:]]*).*/\1<REDACTED>/I' \
    "$f"
done

echo ""
echo "[capture] saved redacted copies to: infra/pbx/asterisk/captured/"
echo "[capture] NEXT:"
echo "  1. grep -riE 'password|secret|token' infra/pbx/asterisk/captured/   # confirm NOTHING leaked"
echo "  2. diff against the *.base.conf templates; reconcile any drift"
echo "  3. git add infra/pbx/asterisk/captured && commit"
echo ""
echo "  ⚠️ Verify by eye before committing — this script redacts known keys, but"
echo "     a non-standard secret line could slip through."
