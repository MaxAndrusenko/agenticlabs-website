#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-agenticlabs}"
DOMAIN="${DOMAIN:-agenticlabs.cloud}"
WWW_DOMAIN="${WWW_DOMAIN:-www.${DOMAIN}}"
DEPLOY_USER="${DEPLOY_USER:-agenticlabs}"
SITE_ROOT="${SITE_ROOT:-/var/www/${APP_NAME}}"
REPO_URL="${REPO_URL:-git@github.com:MaxAndrusenko/agenticlabs-website.git}"
ADMIN_SSH_PUBLIC_KEY="${ADMIN_SSH_PUBLIC_KEY:-ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKQdMjHDjk5Tke1quSB10IP3k2zNcso0x7v6faOBUQRC vovam@VOVABOOK}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root: sudo APP_NAME=${APP_NAME} DOMAIN=${DOMAIN} DEPLOY_USER=${DEPLOY_USER} bash deploy/setup-droplet.sh"
  exit 1
fi

apt-get update
apt-get install -y \
  ca-certificates \
  certbot \
  curl \
  git \
  nginx \
  openssh-client \
  python3-certbot-nginx \
  rsync \
  ufw

if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi

usermod -aG www-data "${DEPLOY_USER}"

install -d -o "${DEPLOY_USER}" -g www-data -m 2775 "${SITE_ROOT}"
install -d -o "${DEPLOY_USER}" -g www-data -m 2775 "${SITE_ROOT}/repo"
install -d -o "${DEPLOY_USER}" -g www-data -m 2775 "${SITE_ROOT}/releases"
install -d -o "${DEPLOY_USER}" -g www-data -m 2775 "${SITE_ROOT}/shared"

install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 700 "/home/${DEPLOY_USER}/.ssh"
install -d -o root -g root -m 700 /root/.ssh

if [[ ! -f "/home/${DEPLOY_USER}/.ssh/id_ed25519" ]]; then
  sudo -u "${DEPLOY_USER}" ssh-keygen -t ed25519 -C "${APP_NAME}-${DEPLOY_USER}@$(hostname -f)" -f "/home/${DEPLOY_USER}/.ssh/id_ed25519" -N ""
fi

touch /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
grep -qxF "${ADMIN_SSH_PUBLIC_KEY}" /root/.ssh/authorized_keys || echo "${ADMIN_SSH_PUBLIC_KEY}" >> /root/.ssh/authorized_keys
grep -qxF "${ADMIN_SSH_PUBLIC_KEY}" "/home/${DEPLOY_USER}/.ssh/authorized_keys" || echo "${ADMIN_SSH_PUBLIC_KEY}" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown root:root /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"

sudo -u "${DEPLOY_USER}" ssh-keyscan github.com >> "/home/${DEPLOY_USER}/.ssh/known_hosts" 2>/dev/null || true
chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/known_hosts"
chmod 600 "/home/${DEPLOY_USER}/.ssh/known_hosts"

cat > "/etc/nginx/sites-available/${APP_NAME}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    root ${SITE_ROOT}/current;
    index index.html;

    access_log /var/log/nginx/${APP_NAME}.access.log;
    error_log /var/log/nginx/${APP_NAME}.error.log;

    location = /healthz {
        access_log off;
        add_header Content-Type text/plain;
        return 200 "ok\n";
    }

    location = /index.html {
        if (\$request_uri = /index.html) {
            return 301 /;
        }

        try_files /index.html =404;
    }

    location ~ ^/(.+)\.html$ {
        if (\$request_uri ~ ^/(.+)\.html$) {
            return 301 /\$1;
        }

        try_files \$uri =404;
    }

    location = /work {
        return 301 /case-studies;
    }

    location = /work/ {
        return 301 /case-studies;
    }

    location ~* \.(?:css|js|svg|png|jpg|jpeg|gif|webp|ico|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri.html \$uri \$uri/ =404;
    }

    error_page 404 /404;
}
NGINX

ln -sfn "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl reload nginx

ufw allow OpenSSH
ufw allow "Nginx Full"
ufw --force enable

cat > "${SITE_ROOT}/shared/app.env" <<ENV
APP_NAME=${APP_NAME}
DOMAIN=${DOMAIN}
WWW_DOMAIN=${WWW_DOMAIN}
SITE_ROOT=${SITE_ROOT}
REPO_URL=${REPO_URL}
BRANCH=main
ENV

chown "${DEPLOY_USER}:www-data" "${SITE_ROOT}/shared/app.env"
chmod 640 "${SITE_ROOT}/shared/app.env"

cat > "/etc/sudoers.d/${APP_NAME}-deploy" <<SUDOERS
${DEPLOY_USER} ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx, /bin/systemctl reload nginx
SUDOERS
chmod 440 "/etc/sudoers.d/${APP_NAME}-deploy"

echo
echo "Droplet base setup complete."
echo "Next:"
echo "1. Add a GitHub deploy key for /home/${DEPLOY_USER}/.ssh/id_ed25519.pub."
echo "2. Point DNS A records for ${DOMAIN} and ${WWW_DOMAIN} at this Droplet."
echo "3. Run deploy/deploy-static.sh as ${DEPLOY_USER}."
echo "4. After DNS resolves, run: sudo certbot --nginx -d ${DOMAIN} -d ${WWW_DOMAIN}"
