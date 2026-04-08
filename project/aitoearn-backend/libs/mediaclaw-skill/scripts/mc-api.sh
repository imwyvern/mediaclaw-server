#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MEDIACLAW_BASE_URL:-https://api.mediaclaw.com}"
BASE_URL="${BASE_URL%/}"
DOWNLOAD_DIR="${MEDIACLAW_DOWNLOAD_DIR:-./downloads/mediaclaw}"
CLIENT_VERSION="${MEDIACLAW_CLIENT_VERSION:-openclaw-skill}"

fail() {
  echo "Error: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_api_key() {
  [[ -n "${MEDIACLAW_API_KEY:-}" ]] || fail "MEDIACLAW_API_KEY is required"
}

pretty_print() {
  jq .
}

urlencode() {
  jq -nr --arg value "$1" '$value | @uri'
}

json_array_from_values() {
  if [[ $# -eq 0 ]]; then
    printf '[]\n'
    return
  fi

  printf '%s\n' "$@" | jq -R . | jq -s 'map(select(length > 0))'
}

read_json_arg() {
  local value="$1"
  if [[ "${value}" == @* ]]; then
    local file_path="${value#@}"
    [[ -f "${file_path}" ]] || fail "JSON file not found: ${file_path}"
    cat "${file_path}"
    return
  fi

  printf '%s\n' "${value}"
}

validate_json() {
  local payload="$1"
  printf '%s\n' "${payload}" | jq -e . >/dev/null
}

require_agent_id() {
  local agent_id="${1:-${MEDIACLAW_AGENT_ID:-}}"
  [[ -n "${agent_id}" ]] || fail "Agent id is required. Pass --agent or set MEDIACLAW_AGENT_ID."
  printf '%s\n' "${agent_id}"
}

sanitize_filename() {
  local raw="${1:-file}"
  local sanitized
  sanitized="$(printf '%s' "${raw}" | tr '[:space:]/:' '___' | tr -cd '[:alnum:]_.-')"
  [[ -n "${sanitized}" ]] || sanitized="file"
  printf '%s\n' "${sanitized}"
}

build_query() {
  local query=""
  local separator="?"
  while [[ $# -gt 1 ]]; do
    local key="$1"
    local value="$2"
    shift 2
    if [[ -n "${value}" ]]; then
      query+="${separator}${key}=$(urlencode "${value}")"
      separator="&"
    fi
  done
  printf '%s\n' "${query}"
}

resolve_period_days() {
  case "${1:-weekly}" in
    daily)
      printf '7\n'
      ;;
    weekly)
      printf '30\n'
      ;;
    monthly)
      printf '90\n'
      ;;
    *)
      if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
        printf '%s\n' "$1"
      else
        fail "Unsupported period: ${1:-}"
      fi
      ;;
  esac
}

api_request() {
  require_api_key
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local response_file
  local http_code
  response_file="$(mktemp)"

  local -a curl_args=(
    -sS
    -X "${method}"
    "${BASE_URL}${path}"
    -H "Accept: application/json"
    -H "Authorization: Bearer ${MEDIACLAW_API_KEY}"
  )

  if [[ -n "${body}" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "${body}")
  fi

  http_code="$(curl "${curl_args[@]}" -o "${response_file}" -w '%{http_code}')"

  if [[ ! "${http_code}" =~ ^2 ]]; then
    cat "${response_file}" >&2 || true
    rm -f "${response_file}"
    fail "API request failed: ${method} ${path} (${http_code})"
  fi

  cat "${response_file}"
  rm -f "${response_file}"
}

download_asset() {
  local content_json="$1"
  local target_dir="$2"
  local content_id
  local title
  local output_url
  local extension
  local base_name
  local video_path
  local metadata_path

  content_id="$(printf '%s\n' "${content_json}" | jq -r '.id // .taskId // empty')"
  output_url="$(printf '%s\n' "${content_json}" | jq -r '.downloadUrl // .outputVideoUrl // empty')"
  title="$(printf '%s\n' "${content_json}" | jq -r '.copy.title // empty')"

  [[ -n "${content_id}" ]] || fail "Content id is missing from download payload"
  [[ -n "${output_url}" ]] || fail "outputVideoUrl is empty for content ${content_id}"

  mkdir -p "${target_dir}"
  extension="$(printf '%s' "${output_url}" | sed -E 's/.*\.([A-Za-z0-9]+)(\?.*)?$/\1/')"
  [[ "${extension}" =~ ^[A-Za-z0-9]{1,5}$ ]] || extension="mp4"

  base_name="$(sanitize_filename "${title:-${content_id}}")-${content_id}"
  video_path="${target_dir}/${base_name}.${extension}"
  metadata_path="${target_dir}/${base_name}.json"

  curl -sS -L "${output_url}" -o "${video_path}"
  printf '%s\n' "${content_json}" | jq . > "${metadata_path}"

  jq -n \
    --arg id "${content_id}" \
    --arg file "${video_path}" \
    --arg metadata "${metadata_path}" \
    '{ id: $id, file: $file, metadata: $metadata }'
}

print_help() {
  cat <<'EOF'
Usage:
  mc-api.sh help
  mc-api.sh register <agent-id> [capability ...]
  mc-api.sh config [--agent AGENT_ID]
  mc-api.sh discover [--agent AGENT_ID]
  mc-api.sh heartbeat [--agent AGENT_ID] [--client-version VERSION] [--capability CAPABILITY]...
  mc-api.sh deliveries [--agent AGENT_ID]
  mc-api.sh confirm-delivery <task-id> [--agent AGENT_ID]
  mc-api.sh list [--status STATUS] [--publish-status STATUS] [--brand-id ID] [--page N] [--limit N]
  mc-api.sh pending
  mc-api.sh preview <content-id>
  mc-api.sh download <content-id|all> [--dir PATH] [--status STATUS] [--publish-status STATUS] [--brand-id ID] [--page N] [--limit N]
  mc-api.sh approve <content-id> [--comment TEXT]
  mc-api.sh review <content-id> --action approve|reject|changes_requested [--comment TEXT]
  mc-api.sh edit-copy <content-id> [--title TEXT] [--subtitle TEXT] [--hashtag TAG]... [--blue-word WORD]... [--comment-guide TEXT]...
  mc-api.sh published <content-id> --platform PLATFORM --url PUBLISH_URL
  mc-api.sh feedback <task-id> --json JSON|@file [--agent AGENT_ID]
  mc-api.sh account
  mc-api.sh balance
  mc-api.sh stats [--period daily|weekly|monthly]
  mc-api.sh analytics-overview [--days N]
  mc-api.sh analytics-content <content-id>
  mc-api.sh analytics-top [--limit N] [--metric METRIC] [--days N]
  mc-api.sh analytics-seo [--window-days N] [--limit N]
  mc-api.sh analytics-report [--type TYPE] [--start-date ISO] [--end-date ISO] [--format FORMAT]... [--wait] [--json JSON|@file]
  mc-api.sh competitors-trending [--industry INDUSTRY] [--limit N]
  mc-api.sh audit-log [--page N] [--limit N] [--action ACTION] [--resource RESOURCE] [--resource-id ID] [--user-id ID] [--start-date ISO] [--end-date ISO]
  mc-api.sh create-task --type brand_replace|remix|new_content [--brand-id ID] [--pipeline-id ID] [--source-url URL] [--metadata JSON|@file]
  mc-api.sh task-list [--status STATUS] [--brand-id ID] [--start-date ISO] [--end-date ISO] [--page N] [--limit N]
  mc-api.sh task-status <task-id>
  mc-api.sh task-update <task-id> --json JSON|@file
  mc-api.sh task-cancel <task-id>
  mc-api.sh task-retry <task-id>
  mc-api.sh task-timeline <task-id>
  mc-api.sh brand-list
  mc-api.sh brand-get <brand-id>
  mc-api.sh brand-update <brand-id> --json JSON|@file
  mc-api.sh brand-assets <brand-id> [--logo-url URL] [--reference-image URL]... [--json JSON|@file]
  mc-api.sh pipeline-list
  mc-api.sh pipeline-get <pipeline-id>
  mc-api.sh pipeline-create --json JSON|@file
  mc-api.sh pipeline-update <pipeline-id> --json JSON|@file
  mc-api.sh pipeline-preferences <pipeline-id> --json JSON|@file
  mc-api.sh pipeline-bind-group <pipeline-id> --json JSON|@file
  mc-api.sh campaign-list [--status STATUS]
  mc-api.sh campaign-create --json JSON|@file
  mc-api.sh campaign-get <campaign-id>
  mc-api.sh campaign-videos <campaign-id>
  mc-api.sh campaign-update <campaign-id> --json JSON|@file
  mc-api.sh campaign-delete <campaign-id>
EOF
}

cmd_register() {
  local agent_id="${1:-}"
  shift || true
  [[ -n "${agent_id}" ]] || fail "register requires <agent-id>"

  local -a capabilities=("$@")
  if [[ ${#capabilities[@]} -eq 0 ]]; then
    capabilities=(delivery review analytics scheduling brand pipeline campaign)
  fi

  local capabilities_json
  local payload
  capabilities_json="$(json_array_from_values "${capabilities[@]}")"
  payload="$(jq -n \
    --arg agentId "${agent_id}" \
    --argjson capabilities "${capabilities_json}" \
    '{ agentId: $agentId, capabilities: $capabilities }')"

  api_request "POST" "/api/v1/skill/register" "${payload}" | pretty_print
}

cmd_config() {
  local agent_id=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent)
        agent_id="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for config: $1"
        ;;
    esac
  done

  agent_id="$(require_agent_id "${agent_id}")"
  api_request "GET" "/api/v1/skill/config$(build_query agentId "${agent_id}")" | pretty_print
}

cmd_discover() {
  local agent_id=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent)
        agent_id="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for discover: $1"
        ;;
    esac
  done

  agent_id="$(require_agent_id "${agent_id}")"
  api_request "GET" "/api/v1/skill/capabilities$(build_query agentId "${agent_id}")" | pretty_print
}

cmd_heartbeat() {
  local agent_id=""
  local client_version="${CLIENT_VERSION}"
  local -a capabilities=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent)
        agent_id="$2"
        shift 2
        ;;
      --client-version)
        client_version="$2"
        shift 2
        ;;
      --capability)
        capabilities+=("$2")
        shift 2
        ;;
      *)
        capabilities+=("$1")
        shift
        ;;
    esac
  done

  if [[ ${#capabilities[@]} -eq 0 && -n "${MEDIACLAW_AGENT_CAPABILITIES:-}" ]]; then
    IFS=',' read -r -a capabilities <<< "${MEDIACLAW_AGENT_CAPABILITIES}"
  fi

  agent_id="$(require_agent_id "${agent_id}")"

  local capabilities_json
  local payload
  capabilities_json="$(json_array_from_values "${capabilities[@]}")"
  payload="$(jq -n \
    --arg agentId "${agent_id}" \
    --arg clientVersion "${client_version}" \
    --argjson capabilities "${capabilities_json}" \
    '
      { agentId: $agentId, clientVersion: $clientVersion }
      + (if ($capabilities | length) == 0 then {} else { capabilities: $capabilities } end)
    ')"

  api_request "POST" "/api/v1/heartbeat" "${payload}" | pretty_print
}

cmd_deliveries() {
  local agent_id=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent)
        agent_id="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for deliveries: $1"
        ;;
    esac
  done

  agent_id="$(require_agent_id "${agent_id}")"
  api_request "GET" "/api/v1/skill/deliveries$(build_query agentId "${agent_id}")" | pretty_print
}

cmd_confirm_delivery() {
  local task_id="${1:-}"
  local agent_id=""
  shift || true
  [[ -n "${task_id}" ]] || fail "confirm-delivery requires <task-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent)
        agent_id="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for confirm-delivery: $1"
        ;;
    esac
  done

  agent_id="$(require_agent_id "${agent_id}")"
  local payload
  payload="$(jq -n --arg agentId "${agent_id}" --arg taskId "${task_id}" '{ agentId: $agentId, taskId: $taskId }')"
  api_request "POST" "/api/v1/skill/confirm-delivery" "${payload}" | pretty_print
}

cmd_list() {
  local status=""
  local publish_status=""
  local brand_id=""
  local page="1"
  local limit="20"
  local start_date=""
  local end_date=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status)
        status="$2"
        shift 2
        ;;
      --publish-status)
        publish_status="$2"
        shift 2
        ;;
      --brand-id)
        brand_id="$2"
        shift 2
        ;;
      --start-date)
        start_date="$2"
        shift 2
        ;;
      --end-date)
        end_date="$2"
        shift 2
        ;;
      --page)
        page="$2"
        shift 2
        ;;
      --limit)
        limit="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for list: $1"
        ;;
    esac
  done

  local query
  query="$(build_query \
    status "${status}" \
    publishStatus "${publish_status}" \
    brandId "${brand_id}" \
    startDate "${start_date}" \
    endDate "${end_date}" \
    page "${page}" \
    limit "${limit}")"

  api_request "GET" "/api/v1/content${query}" | pretty_print
}

cmd_pending() {
  api_request "GET" "/api/v1/content/pending" | pretty_print
}

cmd_preview() {
  local content_id="${1:-}"
  [[ -n "${content_id}" ]] || fail "preview requires <content-id>"
  api_request "GET" "/api/v1/content/${content_id}" | pretty_print
}

cmd_download() {
  local target="${1:-}"
  local dir="${DOWNLOAD_DIR}"
  local status=""
  local publish_status=""
  local brand_id=""
  local start_date=""
  local end_date=""
  local page="1"
  local limit="20"
  shift || true

  [[ -n "${target}" ]] || fail "download requires <content-id|all>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dir)
        dir="$2"
        shift 2
        ;;
      --status)
        status="$2"
        shift 2
        ;;
      --publish-status)
        publish_status="$2"
        shift 2
        ;;
      --brand-id)
        brand_id="$2"
        shift 2
        ;;
      --start-date)
        start_date="$2"
        shift 2
        ;;
      --end-date)
        end_date="$2"
        shift 2
        ;;
      --page)
        page="$2"
        shift 2
        ;;
      --limit)
        limit="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for download: $1"
        ;;
    esac
  done

  if [[ "${target}" == "all" ]]; then
    local query
    local response
    local results_file
    query="$(build_query \
      status "${status}" \
      publishStatus "${publish_status}" \
      brandId "${brand_id}" \
      startDate "${start_date}" \
      endDate "${end_date}" \
      page "${page}" \
      limit "${limit}")"
    response="$(api_request "GET" "/api/v1/content${query}")"
    results_file="$(mktemp)"

    while IFS= read -r item; do
      [[ -n "${item}" ]] || continue
      download_asset "${item}" "${dir}" >> "${results_file}"
    done < <(printf '%s\n' "${response}" | jq -c '.items[]')

    jq -s '{ total: length, items: . }' "${results_file}"
    rm -f "${results_file}"
    return
  fi

  local content_json
  content_json="$(api_request "GET" "/api/v1/content/${target}")"
  download_asset "${content_json}" "${dir}" | pretty_print
}

cmd_approve() {
  local content_id="${1:-}"
  local comment=""
  shift || true
  [[ -n "${content_id}" ]] || fail "approve requires <content-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --comment)
        comment="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for approve: $1"
        ;;
    esac
  done

  local payload
  payload="$(jq -n --arg comment "${comment}" '
    if $comment == "" then {} else { comment: $comment } end
  ')"

  api_request "POST" "/api/v1/content/${content_id}/approve" "${payload}" | pretty_print
}

cmd_review() {
  local content_id="${1:-}"
  local action=""
  local comment=""
  shift || true
  [[ -n "${content_id}" ]] || fail "review requires <content-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --action)
        action="$2"
        shift 2
        ;;
      --comment)
        comment="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for review: $1"
        ;;
    esac
  done

  [[ -n "${action}" ]] || fail "review requires --action approve|reject|changes_requested"
  local payload
  payload="$(jq -n \
    --arg action "${action}" \
    --arg comment "${comment}" \
    '{ action: $action } + (if $comment == "" then {} else { comment: $comment } end)')"

  api_request "POST" "/api/v1/content/${content_id}/review" "${payload}" | pretty_print
}

cmd_edit_copy() {
  local content_id="${1:-}"
  shift || true
  [[ -n "${content_id}" ]] || fail "edit-copy requires <content-id>"

  local title=""
  local subtitle=""
  local -a hashtags=()
  local -a blue_words=()
  local -a comment_guides=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title)
        title="$2"
        shift 2
        ;;
      --subtitle)
        subtitle="$2"
        shift 2
        ;;
      --hashtag)
        hashtags+=("$2")
        shift 2
        ;;
      --blue-word)
        blue_words+=("$2")
        shift 2
        ;;
      --comment-guide)
        comment_guides+=("$2")
        shift 2
        ;;
      *)
        fail "Unknown option for edit-copy: $1"
        ;;
    esac
  done

  local hashtags_json
  local blue_words_json
  local comment_guides_json
  local payload
  hashtags_json="$(json_array_from_values "${hashtags[@]}")"
  blue_words_json="$(json_array_from_values "${blue_words[@]}")"
  comment_guides_json="$(json_array_from_values "${comment_guides[@]}")"

  payload="$(jq -n \
    --arg title "${title}" \
    --arg subtitle "${subtitle}" \
    --argjson hashtags "${hashtags_json}" \
    --argjson blueWords "${blue_words_json}" \
    --argjson commentGuides "${comment_guides_json}" \
    '
      {}
      + (if $title == "" then {} else { title: $title } end)
      + (if $subtitle == "" then {} else { subtitle: $subtitle } end)
      + (if ($hashtags | length) == 0 then {} else { hashtags: $hashtags } end)
      + (if ($blueWords | length) == 0 then {} else { blueWords: $blueWords } end)
      + (if ($commentGuides | length) == 0 then {} else { commentGuides: $commentGuides } end)
    ')"

  api_request "PATCH" "/api/v1/content/${content_id}/copy" "${payload}" | pretty_print
}

cmd_published() {
  local content_id="${1:-}"
  local platform=""
  local publish_url=""
  shift || true
  [[ -n "${content_id}" ]] || fail "published requires <content-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --platform)
        platform="$2"
        shift 2
        ;;
      --url)
        publish_url="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for published: $1"
        ;;
    esac
  done

  [[ -n "${platform}" ]] || fail "published requires --platform"
  [[ -n "${publish_url}" ]] || fail "published requires --url"

  local payload
  payload="$(jq -n \
    --arg platform "${platform}" \
    --arg publishUrl "${publish_url}" \
    '{ platform: $platform, publishUrl: $publishUrl }')"

  api_request "POST" "/api/v1/content/${content_id}/published" "${payload}" | pretty_print
}

cmd_feedback() {
  local task_id="${1:-}"
  local agent_id=""
  local feedback_json=""
  shift || true
  [[ -n "${task_id}" ]] || fail "feedback requires <task-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent)
        agent_id="$2"
        shift 2
        ;;
      --json)
        feedback_json="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for feedback: $1"
        ;;
    esac
  done

  [[ -n "${feedback_json}" ]] || fail "feedback requires --json JSON|@file"
  validate_json "${feedback_json}"
  agent_id="$(require_agent_id "${agent_id}")"

  local payload
  payload="$(jq -n \
    --arg agentId "${agent_id}" \
    --arg taskId "${task_id}" \
    --argjson feedback "${feedback_json}" \
    '{ agentId: $agentId, taskId: $taskId, feedback: $feedback }')"

  api_request "POST" "/api/v1/skill/feedback" "${payload}" | pretty_print
}

cmd_account() {
  api_request "GET" "/api/v1/account/info" | pretty_print
}

cmd_balance() {
  api_request "GET" "/api/v1/usage/summary" | pretty_print
}

cmd_stats() {
  local period="weekly"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --period)
        period="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for stats: $1"
        ;;
    esac
  done

  local period_days
  local account_json
  local balance_json
  local overview_json
  local trends_json
  local top_json
  local seo_json

  period_days="$(resolve_period_days "${period}")"
  account_json="$(api_request "GET" "/api/v1/account/info")"
  balance_json="$(api_request "GET" "/api/v1/usage/summary")"
  overview_json="$(api_request "GET" "/api/v1/analytics/overview$(build_query period "${period_days}")")"
  trends_json="$(api_request "GET" "/api/v1/analytics/trends$(build_query period "${period}")")"
  top_json="$(api_request "GET" "/api/v1/analytics/top$(build_query limit "5" period "${period_days}")")"
  seo_json="$(api_request "GET" "/api/v1/analytics/seo$(build_query windowDays "${period_days}" limit "5")")"

  jq -n \
    --argjson account "${account_json}" \
    --argjson balance "${balance_json}" \
    --argjson overview "${overview_json}" \
    --argjson trends "${trends_json}" \
    --argjson top "${top_json}" \
    --argjson seo "${seo_json}" \
    '{
      account: $account,
      balance: $balance,
      overview: $overview,
      trends: $trends,
      top: $top,
      seo: $seo
    }'
}

cmd_analytics_overview() {
  local days="30"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --days)
        days="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for analytics-overview: $1"
        ;;
    esac
  done

  api_request "GET" "/api/v1/analytics/overview$(build_query period "${days}")" | pretty_print
}

cmd_analytics_content() {
  local content_id="${1:-}"
  [[ -n "${content_id}" ]] || fail "analytics-content requires <content-id>"
  api_request "GET" "/api/v1/analytics/content/${content_id}" | pretty_print
}

cmd_analytics_top() {
  local limit="10"
  local metric="views"
  local days="30"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --limit)
        limit="$2"
        shift 2
        ;;
      --metric)
        metric="$2"
        shift 2
        ;;
      --days)
        days="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for analytics-top: $1"
        ;;
    esac
  done

  api_request "GET" "/api/v1/analytics/top$(build_query limit "${limit}" metric "${metric}" period "${days}")" | pretty_print
}

cmd_analytics_seo() {
  local window_days="30"
  local limit="10"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --window-days)
        window_days="$2"
        shift 2
        ;;
      --limit)
        limit="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for analytics-seo: $1"
        ;;
    esac
  done

  api_request "GET" "/api/v1/analytics/seo$(build_query windowDays "${window_days}" limit "${limit}")" | pretty_print
}

cmd_analytics_report() {
  local type=""
  local start_date=""
  local end_date=""
  local wait_for_completion="false"
  local json_body=""
  local -a formats=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type)
        type="$2"
        shift 2
        ;;
      --start-date)
        start_date="$2"
        shift 2
        ;;
      --end-date)
        end_date="$2"
        shift 2
        ;;
      --format)
        formats+=("$2")
        shift 2
        ;;
      --wait)
        wait_for_completion="true"
        shift
        ;;
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for analytics-report: $1"
        ;;
    esac
  done

  local payload
  if [[ -n "${json_body}" ]]; then
    validate_json "${json_body}"
    payload="${json_body}"
  else
    local formats_json
    formats_json="$(json_array_from_values "${formats[@]}")"
    payload="$(jq -n \
      --arg type "${type}" \
      --arg startDate "${start_date}" \
      --arg endDate "${end_date}" \
      --argjson formats "${formats_json}" \
      --argjson waitForCompletion "${wait_for_completion}" \
      '
        {}
        + (if $type == "" then {} else { type: $type } end)
        + (if $startDate == "" and $endDate == "" then {} else { period: { start: $startDate, end: $endDate } } end)
        + (if ($formats | length) == 0 then {} else { formats: $formats } end)
        + (if $waitForCompletion then { waitForCompletion: true } else {} end)
      ')"
  fi

  api_request "POST" "/api/v1/analytics/report" "${payload}" | pretty_print
}

cmd_competitors_trending() {
  local industry=""
  local limit="10"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --industry)
        industry="$2"
        shift 2
        ;;
      --limit)
        limit="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for competitors-trending: $1"
        ;;
    esac
  done

  api_request "GET" "/api/v1/discovery/pool$(build_query limit "${limit}" industry "${industry}")" | pretty_print
}

cmd_audit_log() {
  local page="1"
  local limit="20"
  local action=""
  local resource=""
  local resource_id=""
  local user_id=""
  local start_date=""
  local end_date=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --page)
        page="$2"
        shift 2
        ;;
      --limit)
        limit="$2"
        shift 2
        ;;
      --action)
        action="$2"
        shift 2
        ;;
      --resource)
        resource="$2"
        shift 2
        ;;
      --resource-id)
        resource_id="$2"
        shift 2
        ;;
      --user-id)
        user_id="$2"
        shift 2
        ;;
      --start-date)
        start_date="$2"
        shift 2
        ;;
      --end-date)
        end_date="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for audit-log: $1"
        ;;
    esac
  done

  api_request "GET" "/api/v1/audit-logs$(build_query \
    page "${page}" \
    limit "${limit}" \
    action "${action}" \
    resource "${resource}" \
    resourceId "${resource_id}" \
    userId "${user_id}" \
    startDate "${start_date}" \
    endDate "${end_date}")" | pretty_print
}

cmd_create_task() {
  local task_type=""
  local brand_id=""
  local pipeline_id=""
  local source_url=""
  local metadata_json="{}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type)
        task_type="$2"
        shift 2
        ;;
      --brand-id)
        brand_id="$2"
        shift 2
        ;;
      --pipeline-id)
        pipeline_id="$2"
        shift 2
        ;;
      --source-url)
        source_url="$2"
        shift 2
        ;;
      --metadata)
        metadata_json="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for create-task: $1"
        ;;
    esac
  done

  [[ -n "${task_type}" ]] || fail "create-task requires --type brand_replace|remix|new_content"
  validate_json "${metadata_json}"

  local payload
  payload="$(jq -n \
    --arg taskType "${task_type}" \
    --arg brandId "${brand_id}" \
    --arg pipelineId "${pipeline_id}" \
    --arg sourceVideoUrl "${source_url}" \
    --argjson metadata "${metadata_json}" \
    '
      { taskType: $taskType, metadata: $metadata }
      + (if $brandId == "" then {} else { brandId: $brandId } end)
      + (if $pipelineId == "" then {} else { pipelineId: $pipelineId } end)
      + (if $sourceVideoUrl == "" then {} else { sourceVideoUrl: $sourceVideoUrl } end)
    ')"

  api_request "POST" "/api/v1/tasks" "${payload}" | pretty_print
}

cmd_task_list() {
  local status=""
  local brand_id=""
  local start_date=""
  local end_date=""
  local page="1"
  local limit="20"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status)
        status="$2"
        shift 2
        ;;
      --brand-id)
        brand_id="$2"
        shift 2
        ;;
      --start-date)
        start_date="$2"
        shift 2
        ;;
      --end-date)
        end_date="$2"
        shift 2
        ;;
      --page)
        page="$2"
        shift 2
        ;;
      --limit)
        limit="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for task-list: $1"
        ;;
    esac
  done

  api_request "GET" "/api/v1/tasks$(build_query \
    status "${status}" \
    brandId "${brand_id}" \
    startDate "${start_date}" \
    endDate "${end_date}" \
    page "${page}" \
    limit "${limit}")" | pretty_print
}

cmd_task_status() {
  local task_id="${1:-}"
  [[ -n "${task_id}" ]] || fail "task-status requires <task-id>"
  api_request "GET" "/api/v1/tasks/${task_id}" | pretty_print
}

cmd_task_update() {
  local task_id="${1:-}"
  local json_body=""
  shift || true
  [[ -n "${task_id}" ]] || fail "task-update requires <task-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for task-update: $1"
        ;;
    esac
  done

  [[ -n "${json_body}" ]] || fail "task-update requires --json JSON|@file"
  validate_json "${json_body}"
  api_request "PATCH" "/api/v1/tasks/${task_id}" "${json_body}" | pretty_print
}

cmd_task_cancel() {
  local task_id="${1:-}"
  [[ -n "${task_id}" ]] || fail "task-cancel requires <task-id>"
  api_request "POST" "/api/v1/tasks/${task_id}/cancel" '{}' | pretty_print
}

cmd_task_retry() {
  local task_id="${1:-}"
  [[ -n "${task_id}" ]] || fail "task-retry requires <task-id>"
  api_request "POST" "/api/v1/tasks/${task_id}/retry" '{}' | pretty_print
}

cmd_task_timeline() {
  local task_id="${1:-}"
  [[ -n "${task_id}" ]] || fail "task-timeline requires <task-id>"
  api_request "GET" "/api/v1/tasks/timeline/${task_id}" | pretty_print
}

cmd_brand_list() {
  api_request "GET" "/api/v1/brand" | pretty_print
}

cmd_brand_get() {
  local brand_id="${1:-}"
  [[ -n "${brand_id}" ]] || fail "brand-get requires <brand-id>"
  api_request "GET" "/api/v1/brand/${brand_id}" | pretty_print
}

cmd_brand_update() {
  local brand_id="${1:-}"
  local json_body=""
  shift || true
  [[ -n "${brand_id}" ]] || fail "brand-update requires <brand-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for brand-update: $1"
        ;;
    esac
  done

  [[ -n "${json_body}" ]] || fail "brand-update requires --json JSON|@file"
  validate_json "${json_body}"
  api_request "PATCH" "/api/v1/brand/${brand_id}" "${json_body}" | pretty_print
}

cmd_brand_assets() {
  local brand_id="${1:-}"
  local json_body=""
  local logo_url=""
  local -a reference_images=()
  shift || true
  [[ -n "${brand_id}" ]] || fail "brand-assets requires <brand-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --logo-url)
        logo_url="$2"
        shift 2
        ;;
      --reference-image)
        reference_images+=("$2")
        shift 2
        ;;
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for brand-assets: $1"
        ;;
    esac
  done

  if [[ -n "${json_body}" ]]; then
    validate_json "${json_body}"
  else
    local reference_images_json
    reference_images_json="$(json_array_from_values "${reference_images[@]}")"
    json_body="$(jq -n \
      --arg logoUrl "${logo_url}" \
      --argjson referenceImages "${reference_images_json}" \
      '
        {}
        + (if $logoUrl == "" then {} else { logoUrl: $logoUrl } end)
        + (if ($referenceImages | length) == 0 then {} else { referenceImages: $referenceImages } end)
      ')"
  fi

  api_request "PATCH" "/api/v1/brand/${brand_id}/assets" "${json_body}" | pretty_print
}

cmd_pipeline_list() {
  api_request "GET" "/api/v1/pipelines" | pretty_print
}

cmd_pipeline_get() {
  local pipeline_id="${1:-}"
  [[ -n "${pipeline_id}" ]] || fail "pipeline-get requires <pipeline-id>"
  api_request "GET" "/api/v1/pipelines/${pipeline_id}" | pretty_print
}

cmd_pipeline_create() {
  local json_body=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for pipeline-create: $1"
        ;;
    esac
  done

  [[ -n "${json_body}" ]] || fail "pipeline-create requires --json JSON|@file"
  validate_json "${json_body}"
  api_request "POST" "/api/v1/pipelines" "${json_body}" | pretty_print
}

cmd_pipeline_update() {
  local pipeline_id="${1:-}"
  local json_body=""
  shift || true
  [[ -n "${pipeline_id}" ]] || fail "pipeline-update requires <pipeline-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for pipeline-update: $1"
        ;;
    esac
  done

  [[ -n "${json_body}" ]] || fail "pipeline-update requires --json JSON|@file"
  validate_json "${json_body}"
  api_request "PATCH" "/api/v1/pipelines/${pipeline_id}" "${json_body}" | pretty_print
}

cmd_pipeline_preferences() {
  local pipeline_id="${1:-}"
  local json_body=""
  shift || true
  [[ -n "${pipeline_id}" ]] || fail "pipeline-preferences requires <pipeline-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for pipeline-preferences: $1"
        ;;
    esac
  done

  [[ -n "${json_body}" ]] || fail "pipeline-preferences requires --json JSON|@file"
  validate_json "${json_body}"
  api_request "PATCH" "/api/v1/pipelines/${pipeline_id}/preferences" "${json_body}" | pretty_print
}

cmd_pipeline_bind_group() {
  local pipeline_id="${1:-}"
  local json_body=""
  shift || true
  [[ -n "${pipeline_id}" ]] || fail "pipeline-bind-group requires <pipeline-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for pipeline-bind-group: $1"
        ;;
    esac
  done

  [[ -n "${json_body}" ]] || fail "pipeline-bind-group requires --json JSON|@file"
  validate_json "${json_body}"
  api_request "PATCH" "/api/v1/pipelines/${pipeline_id}/bind-group" "${json_body}" | pretty_print
}

cmd_campaign_list() {
  local status=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status)
        status="$2"
        shift 2
        ;;
      *)
        fail "Unknown option for campaign-list: $1"
        ;;
    esac
  done

  api_request "GET" "/api/v1/campaigns$(build_query status "${status}")" | pretty_print
}

cmd_campaign_create() {
  local json_body=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for campaign-create: $1"
        ;;
    esac
  done

  [[ -n "${json_body}" ]] || fail "campaign-create requires --json JSON|@file"
  validate_json "${json_body}"
  api_request "POST" "/api/v1/campaigns" "${json_body}" | pretty_print
}

cmd_campaign_get() {
  local campaign_id="${1:-}"
  [[ -n "${campaign_id}" ]] || fail "campaign-get requires <campaign-id>"
  api_request "GET" "/api/v1/campaigns/${campaign_id}" | pretty_print
}

cmd_campaign_videos() {
  local campaign_id="${1:-}"
  [[ -n "${campaign_id}" ]] || fail "campaign-videos requires <campaign-id>"
  api_request "GET" "/api/v1/campaigns/${campaign_id}/videos" | pretty_print
}

cmd_campaign_update() {
  local campaign_id="${1:-}"
  local json_body=""
  shift || true
  [[ -n "${campaign_id}" ]] || fail "campaign-update requires <campaign-id>"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        json_body="$(read_json_arg "$2")"
        shift 2
        ;;
      *)
        fail "Unknown option for campaign-update: $1"
        ;;
    esac
  done

  [[ -n "${json_body}" ]] || fail "campaign-update requires --json JSON|@file"
  validate_json "${json_body}"
  api_request "PATCH" "/api/v1/campaigns/${campaign_id}" "${json_body}" | pretty_print
}

cmd_campaign_delete() {
  local campaign_id="${1:-}"
  [[ -n "${campaign_id}" ]] || fail "campaign-delete requires <campaign-id>"
  api_request "DELETE" "/api/v1/campaigns/${campaign_id}" | pretty_print
}

main() {
  require_command "curl"
  require_command "jq"

  local command="${1:-help}"
  shift || true

  case "${command}" in
    help|-h|--help)
      print_help
      ;;
    register)
      cmd_register "$@"
      ;;
    config)
      cmd_config "$@"
      ;;
    discover)
      cmd_discover "$@"
      ;;
    heartbeat)
      cmd_heartbeat "$@"
      ;;
    deliveries)
      cmd_deliveries "$@"
      ;;
    confirm-delivery)
      cmd_confirm_delivery "$@"
      ;;
    list)
      cmd_list "$@"
      ;;
    pending)
      cmd_pending "$@"
      ;;
    preview)
      cmd_preview "$@"
      ;;
    download)
      cmd_download "$@"
      ;;
    approve)
      cmd_approve "$@"
      ;;
    review)
      cmd_review "$@"
      ;;
    edit-copy)
      cmd_edit_copy "$@"
      ;;
    published)
      cmd_published "$@"
      ;;
    feedback)
      cmd_feedback "$@"
      ;;
    account)
      cmd_account "$@"
      ;;
    balance)
      cmd_balance "$@"
      ;;
    stats)
      cmd_stats "$@"
      ;;
    analytics-overview)
      cmd_analytics_overview "$@"
      ;;
    analytics-content)
      cmd_analytics_content "$@"
      ;;
    analytics-top)
      cmd_analytics_top "$@"
      ;;
    analytics-seo)
      cmd_analytics_seo "$@"
      ;;
    analytics-report)
      cmd_analytics_report "$@"
      ;;
    competitors-trending)
      cmd_competitors_trending "$@"
      ;;
    audit-log)
      cmd_audit_log "$@"
      ;;
    create-task)
      cmd_create_task "$@"
      ;;
    task-list)
      cmd_task_list "$@"
      ;;
    task-status)
      cmd_task_status "$@"
      ;;
    task-update)
      cmd_task_update "$@"
      ;;
    task-cancel)
      cmd_task_cancel "$@"
      ;;
    task-retry)
      cmd_task_retry "$@"
      ;;
    task-timeline)
      cmd_task_timeline "$@"
      ;;
    brand-list)
      cmd_brand_list "$@"
      ;;
    brand-get)
      cmd_brand_get "$@"
      ;;
    brand-update)
      cmd_brand_update "$@"
      ;;
    brand-assets)
      cmd_brand_assets "$@"
      ;;
    pipeline-list)
      cmd_pipeline_list "$@"
      ;;
    pipeline-get)
      cmd_pipeline_get "$@"
      ;;
    pipeline-create)
      cmd_pipeline_create "$@"
      ;;
    pipeline-update)
      cmd_pipeline_update "$@"
      ;;
    pipeline-preferences)
      cmd_pipeline_preferences "$@"
      ;;
    pipeline-bind-group)
      cmd_pipeline_bind_group "$@"
      ;;
    campaign-list)
      cmd_campaign_list "$@"
      ;;
    campaign-create)
      cmd_campaign_create "$@"
      ;;
    campaign-get)
      cmd_campaign_get "$@"
      ;;
    campaign-videos)
      cmd_campaign_videos "$@"
      ;;
    campaign-update)
      cmd_campaign_update "$@"
      ;;
    campaign-delete)
      cmd_campaign_delete "$@"
      ;;
    *)
      fail "Unknown command: ${command}"
      ;;
  esac
}

main "$@"
