#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server (Hetzner Cloud CX23).
# Run as root, right after creating the server with your SSH key:
#
#   scp deploy/scripts/bootstrap.sh root@<ip>:
#   ssh root@<ip> 'bash bootstrap.sh <username>'
#
# What it does:
#   - apt upgrade, base tools, restic, 2 GB swap file
#   - Docker Engine + compose plugin from Docker's apt repo
#   - non-root sudo user <username> in the docker group, with root's SSH keys
#   - SSH: keys only, no root login (only after the user's keys are in place)
#   - ufw: allow 22/tcp, 80/tcp, 443/tcp, 443/udp; deny everything else inbound
#   - fail2ban for sshd, unattended-upgrades (security updates, no auto reboot)
#   - /opt/aio owned by <username>, /etc/cron.d/aio-backup for nightly backups
#
# Note: Docker-published ports bypass ufw. That is fine here because only Caddy
# publishes ports (80/443), which ufw allows anyway. Never publish Postgres or
# Redis ports. Use the Hetzner Cloud Firewall as a second layer (same rules).
set -euo pipefail

USERNAME="${1:-}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/aio}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
[ -n "$USERNAME" ] || { echo "usage: $0 <username>" >&2; exit 1; }
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || echo "warning: tested on Ubuntu 24.04, found ${PRETTY_NAME:-unknown}" >&2

export DEBIAN_FRONTEND=noninteractive
log() { printf '\n==> %s\n' "$*"; }

log "system update and base packages"
apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
	apt-listchanges restic git jq htop

log "swap ($SWAP_SIZE)"
if ! swapon --show | grep -q /swapfile; then
	fallocate -l "$SWAP_SIZE" /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
	sysctl -w vm.swappiness=10
	echo 'vm.swappiness=10' >/etc/sysctl.d/99-swappiness.conf
fi
# Redis recommends overcommit for background saves.
echo 'vm.overcommit_memory=1' >/etc/sysctl.d/99-redis.conf
sysctl -p /etc/sysctl.d/99-redis.conf

log "Docker Engine"
if ! command -v docker >/dev/null; then
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
		>/etc/apt/sources.list.d/docker.list
	apt-get update
	apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Default log rotation for containers not covered by compose logging options.
if [ ! -f /etc/docker/daemon.json ]; then
	cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
	systemctl restart docker
fi
systemctl enable --now docker

log "user $USERNAME"
if ! id "$USERNAME" >/dev/null 2>&1; then
	adduser --disabled-password --gecos "" "$USERNAME"
fi
usermod -aG sudo,docker "$USERNAME"
install -d -m 700 -o "$USERNAME" -g "$USERNAME" "/home/$USERNAME/.ssh"
if [ -s /root/.ssh/authorized_keys ]; then
	cp /root/.ssh/authorized_keys "/home/$USERNAME/.ssh/authorized_keys"
	chown "$USERNAME:$USERNAME" "/home/$USERNAME/.ssh/authorized_keys"
	chmod 600 "/home/$USERNAME/.ssh/authorized_keys"
fi
# Passwordless sudo, since the account has no password (key-only login).
echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >"/etc/sudoers.d/90-$USERNAME"
chmod 440 "/etc/sudoers.d/90-$USERNAME"

log "SSH hardening"
if [ -s "/home/$USERNAME/.ssh/authorized_keys" ]; then
	cat >/etc/ssh/sshd_config.d/10-hardening.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
CONF
	sshd -t
	systemctl reload ssh
else
	echo "WARNING: no SSH keys for $USERNAME, leaving sshd unchanged to avoid a lockout" >&2
fi

log "firewall (ufw)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

log "fail2ban"
cat >/etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "unattended-upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat >/etc/apt/apt.conf.d/52unattended-upgrades-local <<'CONF'
// Security updates only (Ubuntu default origins). Reboot manually or set true.
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF
systemctl enable --now unattended-upgrades

log "deploy directory and backup cron"
install -d -o "$USERNAME" -g "$USERNAME" "$DEPLOY_ROOT"
install -d -m 700 /var/backups/aio
cat >/etc/cron.d/aio-backup <<CRON
# Nightly off-site backup of the aio stack (see deploy/scripts/backup.sh).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root [ -x $DEPLOY_ROOT/deploy/scripts/backup.sh ] && $DEPLOY_ROOT/deploy/scripts/backup.sh >>/var/log/aio-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/aio-backup
cat >/etc/logrotate.d/aio-backup <<'CONF'
/var/log/aio-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
CONF

log "done"
cat <<EOF
Next steps (as $USERNAME, from a new terminal before closing this one):
  ssh $USERNAME@<ip>
  git clone <your repo> $DEPLOY_ROOT && cd $DEPLOY_ROOT/deploy
  cp .env.example .env && chmod 600 .env && \$EDITOR .env
  docker compose up -d
See docs/02-hosting.md for DNS, backups (Storage Box SSH key for root) and checks.
EOF
