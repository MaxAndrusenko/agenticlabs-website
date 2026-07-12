#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-agenticlabs}"
SITE_ROOT="${SITE_ROOT:-/var/www/${APP_NAME}}"

if [[ -f "${SITE_ROOT}/shared/app.env" ]]; then
  # shellcheck disable=SC1090
  source "${SITE_ROOT}/shared/app.env"
fi

REPO_URL="${REPO_URL:-git@github.com:MaxAndrusenko/agenticlabs-website.git}"
BRANCH="${BRANCH:-main}"
REPO_DIR="${REPO_DIR:-${SITE_ROOT}/repo}"
RELEASES_DIR="${RELEASES_DIR:-${SITE_ROOT}/releases}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

command -v git >/dev/null || { echo "git is required"; exit 1; }
command -v rsync >/dev/null || { echo "rsync is required"; exit 1; }

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

if command -v sudo >/dev/null; then
  sudo nginx -t
  sudo systemctl reload nginx
else
  nginx -t
  systemctl reload nginx
fi

find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n "+$((KEEP_RELEASES + 1))" | xargs -r rm -rf

echo "Deployed ${APP_NAME} release ${RELEASE_ID}"

