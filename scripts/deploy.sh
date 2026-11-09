#!/usr/bin/env bash
# Tests and builds the portfolio, copies it to the Pi, and (re)starts the
# portfolio.service user unit on 127.0.0.1:8080.
#
# On the Pi:
#   ~/apps/portfolio/releases/<version>/portfolio   one folder per deploy
#   ~/apps/portfolio/current -> releases/<version>  what the service runs
#
# Usage: scripts/deploy.sh          (or `make deploy`)
#   PI_HOST   SSH host of the Pi (default: mc-pi)
set -euo pipefail

host=${PI_HOST:-mc-pi}
root=$(cd "$(dirname "$0")/.." && pwd)
version=$(git -C "$root" describe --always --dirty 2>/dev/null || date +%Y%m%d-%H%M%S)
keep=5

make -C "$root" test build-pi VERSION="$version"

# The placeholder site from the minecraft-server repo (site@portfolio)
# also wants port 8080. Stop rather than fight it over the port.
if ssh "$host" systemctl --user is-active --quiet site@portfolio.service; then
  cat >&2 <<EOF
deploy: site@portfolio.service is still running on $host and holds port 8080.
Hand the port over once:
  ssh $host 'systemctl --user disable --now site@portfolio.service'
and remove site@portfolio.service from deploy/release.json in the
minecraft-server repo, or mc-agent starts it again on its next release.
EOF
  exit 1
fi

echo "deploying $version to $host"
ssh "$host" "mkdir -p apps/portfolio/releases/$version .config/systemd/user"
scp -q "$root/bin/portfolio-linux-arm64" "$host:apps/portfolio/releases/$version/portfolio"
scp -q "$root/deploy/portfolio.service" "$host:.config/systemd/user/portfolio.service"

ssh "$host" bash -s -- "$version" "$keep" <<'EOF'
set -euo pipefail
version=$1 keep=$2
cd ~/apps/portfolio
chmod +x "releases/$version/portfolio"
ln -sfn "releases/$version" current
systemctl --user daemon-reload
systemctl --user enable --quiet portfolio.service
systemctl --user restart portfolio.service

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null http://127.0.0.1:8080/healthz; then
    echo "portfolio $version is up"
    # Keep the newest few releases, so a rollback is one symlink away.
    ls -1t releases | tail -n +"$((keep + 1))" | while read -r old; do
      [ "$old" = "$version" ] || rm -rf "releases/$old"
    done
    exit 0
  fi
  sleep 1
done
echo "portfolio $version didn't answer on 127.0.0.1:8080/healthz" >&2
systemctl --user status portfolio.service --no-pager >&2 || true
exit 1
EOF
