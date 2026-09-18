#!/usr/bin/env bash
# Prepares the VPS to run the stack. Run once, with sudo, by hand.
#
#   sudo ./install-host.sh
#
# Only the machine, not the application: Docker, the directory layout, and the
# checks that catch the things slice 0 of the deployment plan found. A deploy
# happens on every merge and must never depend on apt.
set -euo pipefail

readonly ROOT=/opt/mbs
# The release workflow connects as this user and runs deploy.sh with no sudo, so
# it has to own the tree and be able to talk to Docker. Slice 0: `root` is
# refused by the box, which redirects to this account.
readonly DEPLOY_USER=admin-mbss

[[ $EUID -eq 0 ]] || {
  echo "Run with sudo." >&2
  exit 1
}

if ! command -v docker >/dev/null; then
  echo "== installing Docker from Docker's own apt repository"
  # Ubuntu's docker.io lags, and compose v2 is a plugin there rather than the
  # `docker compose` this stack invokes everywhere.
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.list <<SOURCE
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable
SOURCE
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# Without this every Docker call in deploy.sh fails with "permission denied
# while trying to connect to the Docker daemon socket" — the pull, every
# compose command, and the migration container. Group membership applies to new
# logins, which each SSH deploy is.
if ! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
  echo "== adding $DEPLOY_USER to the docker group"
  usermod -aG docker "$DEPLOY_USER"
fi

echo "== docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1), compose $(docker compose version --short)"

# Owned by the deploy user, not root. deploy.sh writes images.env here, dumps
# into backups/, and reads .env — all as $DEPLOY_USER over SSH without sudo, so
# a root-owned 0700 tree fails the deploy before it pulls anything.
mkdir -p "$ROOT" "$ROOT/backups"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT"
chmod 750 "$ROOT"

# The checks that matter, from what slice 0 found on this box.
echo
echo "== readiness"

swap_kb=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
if ((swap_kb < 1048576)); then
  echo "  !! swap is ${swap_kb} kB. With 3.8 GiB of RAM and Postgres, Strapi,"
  echo "     the profile, the API and Caddy sharing it, the OOM killer reaps a"
  echo "     container outright rather than paging. Add a swapfile."
else
  echo "  ok swap: $((swap_kb / 1024)) MiB"
fi

swappiness=$(cat /proc/sys/vm/swappiness)
if ((swappiness > 20)); then
  echo "  !! vm.swappiness is $swappiness. Swap here is a safety margin, not"
  echo "     working memory — an eager kernel pages out an idle Next.js working"
  echo "     set and charges the next visitor for it. Pin it to 10."
else
  echo "  ok vm.swappiness: $swappiness"
fi

for port in 80 443; do
  if ss -ltnH "sport = :$port" | grep -q .; then
    echo "  !! port $port is already bound. Caddy needs both."
  else
    echo "  ok port $port is free"
  fi
done

if [[ -f $ROOT/.env ]]; then
  echo "  ok $ROOT/.env exists"
else
  echo "  -- $ROOT/.env is missing. Next, as $DEPLOY_USER (not root):"
  echo "       install -m 600 infra/env.example $ROOT/.env"
  echo "       $ROOT/generate-secrets.sh >> $ROOT/.env"
  echo "     then edit it and remove the blank originals of the generated keys."
fi

echo
echo "== done. The first deploy happens on the next merge to main."
