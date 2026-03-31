#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MEDIACLAW_BASE_URL:-https://api.mediaclaw.com}"
BASE_URL="${BASE_URL%/}"
DOWNLOAD_DIR="${MEDIACLAW_DOWNLOAD_DIR:-./downloads/mediaclaw}"

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
  output_url="$(printf '%s\n' "${content_json}" | jq -r '.outputVideoUrl // empty')"
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
  mc-api.sh stats [--period daily|weekly|monthly]
  mc-api.sh create-task --type brand_replace|remix|new_content [--brand-id ID] [--pipeline-id ID] [--source-url URL] [--metadata JSON|@file]
EOF
}

cmd_register() {
  local agent_id="${1:-}"
  shift || true
  [[ -n "${agent_id}" ]] || fail "register requires <agent-id>"

  local -a capabilities=("$@")
  if [[ ${#capabilities[@]} -eq 0 ]]; then
    capabilities=(delivery review analytics scheduling)
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

  local usage_json
  local overview_json
  local trends_json
  usage_json="$(api_request "GET" "/api/v1/account/usage")"
  overview_json="$(api_request "GET" "/api/v1/analytics/overview")"
  trends_json="$(api_request "GET" "/api/v1/analytics/trends$(build_query period "${period}")")"

  jq -n \
    --argjson usage "${usage_json}" \
    --argjson overview "${overview_json}" \
    --argjson trends "${trends_json}" \
    '{ usage: $usage, overview: $overview, trends: $trends }'
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
    stats)
      cmd_stats "$@"
      ;;
    create-task)
      cmd_create_task "$@"
      ;;
    *)
      fail "Unknown command: ${command}"
      ;;
  esac
}

main "$@"
