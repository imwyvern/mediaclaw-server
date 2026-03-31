#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="${DEPLOY_SERVER:-root@8.129.133.52}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/mediaclaw/server}"
PM2_APP_NAME="${DEPLOY_PM2_APP_NAME:-mediaclaw-api}"
RUNTIME_PORT="${DEPLOY_PORT:-3000}"
ARTIFACT_PATH="${DEPLOY_ARTIFACT_PATH:-${TMPDIR:-/tmp}/mediaclaw-dist.tar.gz}"
SSH_MAX_ATTEMPTS="${DEPLOY_SSH_MAX_ATTEMPTS:-3}"
SSH_RETRY_DELAY="${DEPLOY_SSH_RETRY_DELAY:-60}"
LOCAL_NODE_OPTIONS="${DEPLOY_LOCAL_NODE_OPTIONS:---max-old-space-size=4096}"
REMOTE_ARTIFACT_PATH="/tmp/$(basename "${ARTIFACT_PATH}")"
SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o ServerAliveInterval=5
  -o ServerAliveCountMax=3
)

log() {
  printf '[deploy] %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'missing required command: %s\n' "$1" >&2
    exit 1
  }
}

cleanup() {
  rm -f "${ARTIFACT_PATH}"
}

trap cleanup EXIT

is_retryable_ssh_error() {
  local output="$1"
  printf '%s' "${output}" | grep -Eqi \
    'timed out|operation timed out|connection timed out|banner exchange|connection reset by peer|connection reset'
}

retry_command() {
  local label="$1"
  shift

  local attempt=1
  local output=""
  local exit_code=0

  while (( attempt <= SSH_MAX_ATTEMPTS )); do
    if output="$("$@" 2>&1)"; then
      if [[ -n "${output}" ]]; then
        printf '%s\n' "${output}"
      fi
      return 0
    fi

    exit_code=$?
    if [[ -n "${output}" ]]; then
      printf '%s\n' "${output}" >&2
    fi

    if is_retryable_ssh_error "${output}" && (( attempt < SSH_MAX_ATTEMPTS )); then
      log "${label} 遇到 SSH 超时/连接异常，${SSH_RETRY_DELAY}s 后重试（${attempt}/${SSH_MAX_ATTEMPTS}）"
      sleep "${SSH_RETRY_DELAY}"
      ((attempt++))
      continue
    fi

    return "${exit_code}"
  done

  return 1
}

run_ssh() {
  local remote_script="$1"
  retry_command "ssh" ssh "${SSH_OPTS[@]}" "${SERVER}" "${remote_script}"
}

run_scp() {
  local source_path="$1"
  local target_path="$2"
  retry_command "scp" scp "${SSH_OPTS[@]}" "${source_path}" "${SERVER}:${target_path}"
}

build_local() {
  log '本地构建全部 Nx 项目'
  (
    cd "${ROOT_DIR}"
    NODE_OPTIONS="${LOCAL_NODE_OPTIONS}" npx nx run-many --target=build --all --skip-nx-cache --outputStyle=static
  )

  [[ -f "${ROOT_DIR}/dist/apps/aitoearn-server/src/main.js" ]] || {
    printf 'missing build output: dist/apps/aitoearn-server/src/main.js\n' >&2
    exit 1
  }
}

package_artifact() {
  log '打包 dist 产物'
  if tar --help 2>&1 | grep -q -- '--no-mac-metadata'; then
    COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "${ARTIFACT_PATH}" -C "${ROOT_DIR}" dist
    return
  fi

  COPYFILE_DISABLE=1 tar czf "${ARTIFACT_PATH}" -C "${ROOT_DIR}" dist
}

ensure_remote_runtime() {
  log '检查远端运行时依赖'
  run_ssh "$(cat <<EOF
set -Eeuo pipefail
mkdir -p "${REMOTE_DIR}"
cd "${REMOTE_DIR}"

if [[ ! -d node_modules ]]; then
  echo "missing ${REMOTE_DIR}/node_modules; remote install is forbidden for this deploy flow" >&2
  exit 1
fi

node -e "require.resolve('tsconfig-paths/register')" >/dev/null
EOF
)"
}

deploy_remote() {
  log '上传 dist 压缩包到远端'
  run_scp "${ARTIFACT_PATH}" "${REMOTE_ARTIFACT_PATH}"

  log '在远端解压并重启 PM2 服务'
  run_ssh "$(cat <<EOF
set -Eeuo pipefail
cd "${REMOTE_DIR}"

rm -rf dist
tar xzf "${REMOTE_ARTIFACT_PATH}" -C "${REMOTE_DIR}"

REDIS_PASSWORD=""
if [[ -f /etc/redis/redis.conf ]]; then
  REDIS_PASSWORD="\$(sed -n 's/^[[:space:]]*requirepass[[:space:]]\+//p' /etc/redis/redis.conf | head -n 1)"
fi

cat > tsconfig.runtime.json <<'JSONEOF'
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@yikart/*": ["dist/libs/*/src"]
    }
  }
}
JSONEOF

cat > runtime.config.js <<JSEOF
module.exports = {
  appDomain: '8.129.133.52',
  port: ${RUNTIME_PORT},
  environment: 'production',
  enableBadRequestDetails: false,
  logger: {
    console: {
      enable: true,
      level: 'info',
      pretty: false,
      singleLine: true,
      translateTime: true,
    },
  },
  auth: {
    secret: 'mediaclaw-prod-jwt-secret-2026',
    internalToken: 'mediaclaw-internal-token',
  },
  redis: {
    host: '127.0.0.1',
    port: 6379,
    username: 'default',
    password: process.env.REDIS_PASSWORD || undefined,
  },
  mongodb: {
    uri: 'mongodb://127.0.0.1:27017',
    dbName: 'aitoearn',
    autoIndex: true,
    autoCreate: true,
  },
  redlock: {
    redis: {
      host: '127.0.0.1',
      port: 6379,
      username: 'default',
      password: process.env.REDIS_PASSWORD || undefined,
    },
  },
  aliSms: {
    accessKeyId: '',
    accessKeySecret: '',
    signName: '',
    templateCode: '',
  },
  assets: {
    provider: 's3',
    region: 'auto',
    bucketName: 'mediaclaw-assets',
    endpoint: 'http://127.0.0.1:9000',
    publicEndpoint: 'http://127.0.0.1:9000',
    forcePathStyle: true,
  },
  mail: {
    transport: {
      auth: {},
    },
    defaults: {},
  },
  aiClient: {
    baseUrl: 'http://127.0.0.1:3010',
    token: 'mediaclaw-internal-token',
  },
  credits: {},
  channel: {
    channelDb: {
      uri: 'mongodb://127.0.0.1:27017',
      dbName: 'aitoearn_channel',
      autoIndex: true,
      autoCreate: true,
    },
    moreApi: {},
    shortLink: {},
    bilibili: {},
    douyin: {},
    kwai: {},
    google: {},
    googleBusiness: {},
    pinterest: {},
    tiktok: {},
    twitter: {},
    oauth: {
      facebook: {},
      threads: {},
      instagram: {},
      linkedin: {},
    },
    wxPlat: {},
    myWxPlat: {},
    youtube: {},
  },
}
JSEOF

cat > .env.runtime <<'ENVEOF'
NODE_ENV=production
APP_DOMAIN=8.129.133.52
JWT_SECRET=mediaclaw-prod-jwt-secret-2026
INTERNAL_TOKEN=mediaclaw-internal-token
MEDIACLAW_PLATFORM_ACCOUNT_SECRET=mediaclaw-platform-secret-2026
MEDIACLAW_ENABLE_WORKER=false
MEDIACLAW_HEAP_HEALTH_LIMIT_MB=768
TIKHUB_BASE_URL=
TIKHUB_API_KEY=
XORPAY_API_URL=
XORPAY_CREATE_ORDER_URL=
XORPAY_APP_ID=
XORPAY_NOTIFY_URL=
XORPAY_RETURN_URL=
XORPAY_SECRET=
XORPAY_MD5_KEY=
ENVEOF
printf 'REDIS_PASSWORD=%q\n' "\${REDIS_PASSWORD}" >> .env.runtime

pm2 delete "${PM2_APP_NAME}" 2>/dev/null || true

set -a
source ./.env.runtime
set +a

TS_NODE_PROJECT="${REMOTE_DIR}/tsconfig.runtime.json" \
pm2 start "${REMOTE_DIR}/dist/apps/aitoearn-server/src/main.js" \
  --name "${PM2_APP_NAME}" \
  --cwd "${REMOTE_DIR}" \
  --update-env \
  --max-memory-restart 1G \
  --node-args="-r tsconfig-paths/register --max-old-space-size=1024" \
  -- -c "${REMOTE_DIR}/runtime.config.js"

pm2 save
sleep 10
pm2 status "${PM2_APP_NAME}"

if ! curl --fail --silent --max-time 10 "http://127.0.0.1:${RUNTIME_PORT}/health" >/dev/null; then
  pm2 logs "${PM2_APP_NAME}" --lines 120 --nostream || true
  exit 1
fi

curl --fail --silent --max-time 10 "http://127.0.0.1:${RUNTIME_PORT}/api/v1/health"
rm -f "${REMOTE_ARTIFACT_PATH}"
EOF
)"
}

configure_remote_nginx() {
  log '配置远端 nginx 反向代理'
  run_ssh "$(cat <<'EOF'
set -Eeuo pipefail

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is not installed on remote server" >&2
  exit 1
fi

mkdir -p /opt/mediaclaw/web

read -r -d '' NGINX_CONF <<'NGEOF' || true
server {
    listen 80;
    server_name _;

    location = /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGEOF

if [[ -d /etc/nginx/sites-available ]] && [[ -d /etc/nginx/sites-enabled ]]; then
  printf '%s\n' "${NGINX_CONF}" > /etc/nginx/sites-available/mediaclaw
  ln -sf /etc/nginx/sites-available/mediaclaw /etc/nginx/sites-enabled/mediaclaw
  rm -f /etc/nginx/sites-enabled/default
else
  printf '%s\n' "${NGINX_CONF}" > /etc/nginx/conf.d/mediaclaw.conf
fi

nginx -t
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart nginx
else
  nginx -s reload
fi
EOF
)"
}

verify_public_health() {
  log '校验公网健康检查'
  curl --fail --silent --max-time 10 "http://8.129.133.52/health" >/dev/null
  curl --fail --silent --max-time 10 "http://8.129.133.52/api/v1/health"
  printf '\n'
}

main() {
  require_cmd tar
  require_cmd ssh
  require_cmd scp
  require_cmd curl
  require_cmd node
  require_cmd npx

  build_local
  package_artifact
  ensure_remote_runtime
  deploy_remote
  configure_remote_nginx
  verify_public_health

  log 'DEPLOY V2 COMPLETE'
  printf 'DEPLOY V2 COMPLETE\n'
}

main "$@"
