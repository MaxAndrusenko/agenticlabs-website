#!/usr/bin/env bash
set -euxo pipefail

APP_NAME=agenticlabs
DOMAIN=agenticlabs.cloud
WWW_DOMAIN=www.agenticlabs.cloud
DEPLOY_USER=agenticlabs
SITE_ROOT=/var/www/$APP_NAME
REPO_URL=git@github.com:MaxAndrusenko/agenticlabs-website.git
BRANCH=main
ADMIN_SSH_PUBLIC_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKQdMjHDjk5Tke1quSB10IP3k2zNcso0x7v6faOBUQRC vovam@VOVABOOK"

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

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi

usermod -aG www-data "$DEPLOY_USER"

install -d -o "$DEPLOY_USER" -g www-data -m 2775 "$SITE_ROOT"
install -d -o "$DEPLOY_USER" -g www-data -m 2775 "$SITE_ROOT/repo"
install -d -o "$DEPLOY_USER" -g www-data -m 2775 "$SITE_ROOT/releases"
install -d -o "$DEPLOY_USER" -g www-data -m 2775 "$SITE_ROOT/shared"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "/home/$DEPLOY_USER/.ssh"
install -d -o root -g root -m 700 /root/.ssh

if [[ ! -f "/home/$DEPLOY_USER/.ssh/id_ed25519" ]]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -C "$APP_NAME-$DEPLOY_USER@$(hostname -f)" -f "/home/$DEPLOY_USER/.ssh/id_ed25519" -N ""
fi

touch /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
grep -qxF "$ADMIN_SSH_PUBLIC_KEY" /root/.ssh/authorized_keys || echo "$ADMIN_SSH_PUBLIC_KEY" >> /root/.ssh/authorized_keys
grep -qxF "$ADMIN_SSH_PUBLIC_KEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" || echo "$ADMIN_SSH_PUBLIC_KEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown root:root /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

sudo -u "$DEPLOY_USER" ssh-keyscan github.com >> "/home/$DEPLOY_USER/.ssh/known_hosts" 2>/dev/null || true
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/known_hosts"
chmod 600 "/home/$DEPLOY_USER/.ssh/known_hosts"

cat > /etc/nginx/sites-available/$APP_NAME <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN $WWW_DOMAIN;

    root $SITE_ROOT/current;
    index index.html;

    access_log /var/log/nginx/$APP_NAME.access.log;
    error_log /var/log/nginx/$APP_NAME.error.log;

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

ln -sfn /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/$APP_NAME
rm -f /etc/nginx/sites-enabled/default

cat > "$SITE_ROOT/shared/app.env" <<ENV
APP_NAME=$APP_NAME
DOMAIN=$DOMAIN
WWW_DOMAIN=$WWW_DOMAIN
SITE_ROOT=$SITE_ROOT
REPO_URL=$REPO_URL
BRANCH=$BRANCH
ENV

chown "$DEPLOY_USER:www-data" "$SITE_ROOT/shared/app.env"
chmod 640 "$SITE_ROOT/shared/app.env"

cat > /etc/sudoers.d/$APP_NAME-deploy <<SUDOERS
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx, /bin/systemctl reload nginx
SUDOERS
chmod 440 /etc/sudoers.d/$APP_NAME-deploy

cat > /usr/local/bin/deploy-agenticlabs <<'DEPLOY'
#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-agenticlabs}"
SITE_ROOT="${SITE_ROOT:-/var/www/${APP_NAME}}"

if [[ -f "${SITE_ROOT}/shared/app.env" ]]; then
  source "${SITE_ROOT}/shared/app.env"
fi

REPO_URL="${REPO_URL:-git@github.com:MaxAndrusenko/agenticlabs-website.git}"
BRANCH="${BRANCH:-main}"
REPO_DIR="${REPO_DIR:-${SITE_ROOT}/repo}"
RELEASES_DIR="${RELEASES_DIR:-${SITE_ROOT}/releases}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

mkdir -p "${REPO_DIR}" "${RELEASES_DIR}"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  git clone --branch "${BRANCH}" "${REPO_URL}" "${REPO_DIR}"
fi

cd "${REPO_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"

if [[ -f package.json ]]; then
  command -v npm >/dev/null || { echo "npm is required because package.json exists"; exit 1; }

  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi

  if npm run | grep -qE '^  build$|^    build$'; then
    npm run build
  fi
fi

SOURCE_DIR="${REPO_DIR}"
for candidate in dist build out public; do
  if [[ -f "${REPO_DIR}/${candidate}/index.html" ]]; then
    SOURCE_DIR="${REPO_DIR}/${candidate}"
    break
  fi
done

if [[ ! -f "${SOURCE_DIR}/index.html" ]]; then
  echo "No index.html found in ${SOURCE_DIR}; aborting deploy."
  exit 1
fi

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
mkdir -p "${RELEASE_DIR}"

rsync -a --delete \
  --exclude ".git/" \
  --exclude ".github/" \
  --exclude "deploy/" \
  --exclude "docs/" \
  --exclude "node_modules/" \
  --exclude ".env" \
  --exclude "*.log" \
  "${SOURCE_DIR}/" "${RELEASE_DIR}/"

ln -sfn "${RELEASE_DIR}" "${SITE_ROOT}/current"
sudo nginx -t
sudo systemctl reload nginx

find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n "+$((KEEP_RELEASES + 1))" | xargs -r rm -rf
echo "Deployed ${APP_NAME} release ${RELEASE_ID}"
DEPLOY

chmod +x /usr/local/bin/deploy-agenticlabs

ufw allow OpenSSH
ufw allow "Nginx Full"
ufw --force enable

nginx -t
systemctl enable nginx
systemctl reload nginx

cat > /root/AGENTICLABS_NEXT_STEPS.txt <<STEPS
Server bootstrap is complete.

Your SSH public key has been installed for root and $DEPLOY_USER.
You should be able to connect with:
ssh root@DROPLET_IP
ssh $DEPLOY_USER@DROPLET_IP

1. Add this GitHub deploy key to MaxAndrusenko/agenticlabs-website:

$(cat /home/$DEPLOY_USER/.ssh/id_ed25519.pub)

GitHub path:
Repo -> Settings -> Deploy keys -> Add deploy key
Title: agenticlabs-web-01
Allow write access: unchecked

2. Point DNS:
A     @      this Droplet IP
A     www    this Droplet IP

3. After the deploy key is added, run:
sudo -u $DEPLOY_USER git ls-remote $REPO_URL HEAD
sudo -u $DEPLOY_USER deploy-agenticlabs

4. After DNS resolves, enable HTTPS:
certbot --nginx -d $DOMAIN -d $WWW_DOMAIN
certbot renew --dry-run
STEPS

echo "Startup complete. Read /root/AGENTICLABS_NEXT_STEPS.txt"
