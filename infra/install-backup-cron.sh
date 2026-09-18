#!/usr/bin/env bash
# Installs the nightly backup on the VPS. Run once, with sudo, by hand.
#
#   sudo ./install-backup-cron.sh
#
# Separate from deploy.sh on purpose: a deploy happens on every merge and must
# not depend on apt, and this changes the machine rather than the application.
set -euo pipefail

readonly CRON_FILE=/etc/cron.d/mbs-backup
readonly LOG=/var/log/mbs-backup.log

[[ $EUID -eq 0 ]] || {
  echo "Run with sudo." >&2
  exit 1
}

# `age` and the aws CLI are what backup.sh pipes through. Both from apt, so
# there is no curl-into-bash and no version nobody chose.
missing=()
command -v age >/dev/null || missing+=(age)
command -v aws >/dev/null || missing+=(awscli)
if ((${#missing[@]})); then
  echo "== installing ${missing[*]}"
  apt-get update -qq
  apt-get install -y -qq "${missing[@]}"
fi

grep -q BACKUP_AGE_RECIPIENT /opt/mbs/.env 2>/dev/null || {
  echo "/opt/mbs/.env has no BACKUP_AGE_RECIPIENT." >&2
  echo >&2
  echo "Generate the key OFF this machine and keep the private half in a" >&2
  echo "password manager:" >&2
  echo >&2
  echo "    age-keygen -o mbs-backup.key      # on your laptop, not here" >&2
  echo >&2
  echo "Put only the public line (age1...) in /opt/mbs/.env as" >&2
  echo "BACKUP_AGE_RECIPIENT. The box needs nothing else: age encrypts with the" >&2
  echo "public half alone." >&2
  echo >&2
  echo "This is the whole lesson of the previous iteration. Its backups ran" >&2
  echo "nightly and reported success for months, and every one of them is" >&2
  echo "unreadable, because the only copy of the key was on the machine the" >&2
  echo "backups existed to survive." >&2
  exit 1
}

# 03:17, not 03:00. Nothing else on the box competes, but a job on the hour is
# the one most likely to collide with somebody's future cron.
cat > "$CRON_FILE" <<EOF
# Nightly database backup, encrypted off-box. Installed by
# infra/install-backup-cron.sh; edit that rather than this file.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root /opt/mbs/backup.sh >> $LOG 2>&1
EOF
chmod 644 "$CRON_FILE"

touch "$LOG"
chmod 640 "$LOG"

echo "== installed $CRON_FILE"
echo
echo "Run it once now to prove it works:"
echo "    sudo /opt/mbs/backup.sh"
echo
echo "Then prove a restore, which is the only evidence that counts, using the"
echo "key as stored off this machine:"
echo "    /opt/mbs/restore-drill.sh mbs_core /path/to/mbs-backup.key"
