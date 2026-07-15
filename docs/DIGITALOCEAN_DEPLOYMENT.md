# DigitalOcean Deployment

This repo is currently a static website. The setup below serves it from a fresh Ubuntu Droplet with Nginx and HTTPS, while keeping a simple path to add an Express API later.

## Assumptions

- Droplet OS: Ubuntu 24.04 LTS.
- Repo: `git@github.com:MaxAndrusenko/agenticlabs-website.git`.
- Branch: `main`.
- App name: `agenticlabs`.
- Domain: `agenticlabs.cloud`.
- Deploy user: `agenticlabs`.
- Admin SSH public key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKQdMjHDjk5Tke1quSB10IP3k2zNcso0x7v6faOBUQRC vovam@VOVABOOK`.

## 1. Create The Droplet

Create a fresh DigitalOcean Droplet:

- Image: Ubuntu 24.04 LTS.
- Size: the smallest basic Droplet is enough for this static site.
- Authentication: SSH key.
- Hostname: `agenticlabs-web-01`.
- Additional Options: enable `Startup scripts` and paste [digitalocean-startup.sh](../deploy/digitalocean-startup.sh).

From your machine:

```bash
ssh root@YOUR_DROPLET_IP
```

## 2. Option A: Use Startup Script During Droplet Creation

The recommended path is to paste [digitalocean-startup.sh](../deploy/digitalocean-startup.sh) into the Droplet creation page under `Additional Options` -> `Startup scripts`.

After the Droplet finishes booting, SSH in:

```bash
ssh root@YOUR_DROPLET_IP
```

Then read the generated next-step file:

```bash
cat /root/AGENTICLABS_NEXT_STEPS.txt
```

This file contains the GitHub deploy key to add and the exact first-deploy commands.

The startup script also installs your `vovam@VOVABOOK` SSH public key for both `root` and `agenticlabs`.

## 3. Option B: Copy Deployment Files After Droplet Creation

From your local checkout, copy the deployment scripts:

```bash
scp -r deploy root@YOUR_DROPLET_IP:/root/agenticlabs-deploy
```

Then SSH into the Droplet:

```bash
ssh root@YOUR_DROPLET_IP
```

## 4. Bootstrap The Server Manually

Run the setup script as root:

```bash
cd /root/agenticlabs-deploy
chmod +x setup-droplet.sh deploy-static.sh
APP_NAME=agenticlabs \
DOMAIN=agenticlabs.cloud \
WWW_DOMAIN=www.agenticlabs.cloud \
DEPLOY_USER=agenticlabs \
REPO_URL=git@github.com:MaxAndrusenko/agenticlabs-website.git \
bash setup-droplet.sh
```

The script installs Nginx, Git, rsync, UFW, and Certbot. It also creates:

- Linux user: `agenticlabs`.
- Site root: `/var/www/agenticlabs`.
- Repo checkout path: `/var/www/agenticlabs/repo`.
- Release path: `/var/www/agenticlabs/releases`.
- Current release symlink: `/var/www/agenticlabs/current`.
- Nginx site: `/etc/nginx/sites-available/agenticlabs`.
- GitHub deploy key: `/home/agenticlabs/.ssh/id_ed25519.pub`.

## 5. Add GitHub Deploy Key

On the Droplet, print the public key:

```bash
cat /home/agenticlabs/.ssh/id_ed25519.pub
```

In GitHub:

1. Open `MaxAndrusenko/agenticlabs-website`.
2. Go to `Settings` -> `Deploy keys`.
3. Click `Add deploy key`.
4. Title: `agenticlabs-web-01`.
5. Paste the public key.
6. Leave `Allow write access` unchecked.
7. Save.

Test repo access from the Droplet:

```bash
sudo -u agenticlabs ssh -T git@github.com
sudo -u agenticlabs git ls-remote git@github.com:MaxAndrusenko/agenticlabs-website.git HEAD
```

The SSH command may say GitHub does not provide shell access. That is fine. The `git ls-remote` command should print a commit hash.

## 6. Point DNS To The Droplet

In your domain DNS settings, create:

```text
A     @      YOUR_DROPLET_IP
A     www    YOUR_DROPLET_IP
```

Wait until DNS resolves:

```bash
dig +short agenticlabs.cloud
dig +short www.agenticlabs.cloud
```

Both should return the Droplet IP.

## 7. First Deploy

On the Droplet:

```bash
cp /root/agenticlabs-deploy/deploy-static.sh /usr/local/bin/deploy-agenticlabs
chmod +x /usr/local/bin/deploy-agenticlabs
sudo -u agenticlabs deploy-agenticlabs
```

Check the site locally on the Droplet:

```bash
curl -I http://localhost
curl http://localhost/healthz
```

Then open:

```text
http://agenticlabs.cloud
```

## 8. Enable HTTPS

After DNS points to the Droplet:

```bash
certbot --nginx -d agenticlabs.cloud -d www.agenticlabs.cloud
```

Choose the redirect-to-HTTPS option when Certbot asks.

Check renewal:

```bash
certbot renew --dry-run
```

## 9. Normal Deploys

After pushing changes to GitHub:

```bash
ssh agenticlabs@YOUR_DROPLET_IP
deploy-agenticlabs
```

The deploy script:

1. Pulls `origin/main`.
2. Uses the repo root as the static source.
3. If a future `package.json` exists, installs dependencies and runs `npm run build`.
4. Publishes a timestamped release.
5. Atomically updates `/var/www/agenticlabs/current`.
6. Reloads Nginx.
7. Keeps the latest 5 releases.

## 10. Roll Back

List releases:

```bash
ls -1 /var/www/agenticlabs/releases
```

Switch to a previous release:

```bash
ln -sfn /var/www/agenticlabs/releases/RELEASE_ID /var/www/agenticlabs/current
nginx -t
systemctl reload nginx
```

## 11. Contact API (Express + Resend)

The contact form posts to `/api/contact`. Keep the static site where it is and run Express behind Nginx.

1. On the droplet, install Node 18+, then from the release directory:

```bash
cp .env.example .env
# Edit .env: replace re_xxxxxxxxx with your real Resend API key
npm install --omit=dev
```

2. Run Express on `127.0.0.1:3000` (e.g. `npm start`) and manage it with `systemd`.
3. Add this block to `/etc/nginx/sites-available/agenticlabs`:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then reload Nginx:

```bash
nginx -t
systemctl reload nginx
```
