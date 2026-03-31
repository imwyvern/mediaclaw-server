#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${STANDALONE_OUTPUT_DIR:-${ROOT_DIR}/.deploy/standalone}"

if [[ ! -f "${ROOT_DIR}/.next/standalone/server.js" ]]; then
  echo "missing standalone server output: ${ROOT_DIR}/.next/standalone/server.js" >&2
  echo "run pnpm build first" >&2
  exit 1
fi

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}/.next"

cp -R "${ROOT_DIR}/.next/standalone/." "${OUTPUT_DIR}/"

if [[ -d "${ROOT_DIR}/.next/static" ]]; then
  mkdir -p "${OUTPUT_DIR}/.next/static"
  cp -R "${ROOT_DIR}/.next/static/." "${OUTPUT_DIR}/.next/static/"
fi

if [[ -d "${ROOT_DIR}/public" ]]; then
  mkdir -p "${OUTPUT_DIR}/public"
  cp -R "${ROOT_DIR}/public/." "${OUTPUT_DIR}/public/"
fi

cp "${ROOT_DIR}/ecosystem.config.cjs" "${OUTPUT_DIR}/ecosystem.config.cjs"

if [[ -f "${ROOT_DIR}/.env.production" ]]; then
  cp "${ROOT_DIR}/.env.production" "${OUTPUT_DIR}/.env.production"
fi

echo "standalone bundle prepared at ${OUTPUT_DIR}"
