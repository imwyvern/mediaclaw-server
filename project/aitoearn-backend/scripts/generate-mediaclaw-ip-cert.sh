#!/usr/bin/env bash

set -euo pipefail

IP_ADDRESS="${1:-${MEDIACLAW_TLS_IP:-}}"
OUTPUT_DIR="${2:-docker/certs}"

if [[ -z "${IP_ADDRESS}" ]]; then
  echo "Usage: $0 <public-ip> [output-dir]" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"

TMP_CONFIG="$(mktemp)"
cleanup() {
  rm -f "${TMP_CONFIG}"
}
trap cleanup EXIT

cat >"${TMP_CONFIG}" <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${IP_ADDRESS}

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
IP.1 = ${IP_ADDRESS}
EOF

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -sha256 \
  -days 365 \
  -keyout "${OUTPUT_DIR}/mediaclaw-ip.key" \
  -out "${OUTPUT_DIR}/mediaclaw-ip.crt" \
  -config "${TMP_CONFIG}" \
  -extensions v3_req

chmod 600 "${OUTPUT_DIR}/mediaclaw-ip.key"

echo "Generated ${OUTPUT_DIR}/mediaclaw-ip.crt and ${OUTPUT_DIR}/mediaclaw-ip.key for ${IP_ADDRESS}"
