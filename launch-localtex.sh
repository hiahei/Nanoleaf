#!/bin/zsh
set -euo pipefail

APP_ROOT="${0:A:h}"
cd "$APP_ROOT"

LOCAL_URL="http://127.0.0.1:4177"
DATA_ROOT="$APP_ROOT/data"
OUTPUT_LOG="$DATA_ROOT/localtex-service.log"
ERROR_LOG="$DATA_ROOT/localtex-service-error.log"

show_error() {
  local message="$1"
  print -u2 "LocalTeX startup failed: $message"
  if [[ "${LOCAL_TEX_HEADLESS:-0}" != "1" ]] && [[ -x /usr/bin/osascript ]]; then
    /usr/bin/osascript \
      -e 'on run argv' \
      -e 'display alert "LocalTeX 启动失败" message (item 1 of argv) as critical' \
      -e 'end run' \
      -- "$message" >/dev/null 2>&1 || true
  fi
}

node_major_version() {
  local candidate="$1"
  [[ -x "$candidate" ]] || return 1
  local raw
  raw="$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  [[ "$raw" == <-> ]] && (( raw >= 20 ))
}

find_node_binary() {
  local candidates=()
  candidates+=("$APP_ROOT/tools/node/bin/node")
  if command -v node >/dev/null 2>&1; then
    candidates+=("$(command -v node)")
  fi
  candidates+=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "/opt/local/bin/node"
    "$HOME/.volta/bin/node"
    "$HOME/.local/share/fnm/aliases/default/bin/node"
  )
  local nvm_nodes=("$HOME"/.nvm/versions/node/v*/bin/node(NOn))
  candidates+=("${nvm_nodes[@]}")

  local candidate
  for candidate in "${candidates[@]}"; do
    if node_major_version "$candidate"; then
      print -r -- "$candidate"
      return 0
    fi
  done
  return 1
}

is_service_ready() {
  /usr/bin/curl -fsS --max-time 1 "$LOCAL_URL/api/config" >/dev/null 2>&1
}

if ! is_service_ready; then
  NODE_BIN="$(find_node_binary || true)"
  if [[ -z "$NODE_BIN" ]]; then
    show_error "未找到 Node.js (>= 20)。请先通过 Homebrew (brew install node) 或 nvm 安装 Node.js。"
    exit 1
  fi

  if [[ ! -d "$APP_ROOT/node_modules" ]]; then
    show_error "尚未安装项目依赖，请先在项目目录执行 npm ci。"
    exit 1
  fi

  mkdir -p "$DATA_ROOT"
  export PATH="${NODE_BIN:h}:/Library/TeX/texbin:$HOME/Library/TinyTeX/bin/universal-darwin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  export LOCAL_TEX_HOST="0.0.0.0"
  export LOCAL_TEX_PORT="4177"
  export LOCAL_TEX_OPEN_BROWSER="0"
  unset LOCAL_TEX_LAN || true

  nohup "$NODE_BIN" "$APP_ROOT/server.js" >>"$OUTPUT_LOG" 2>>"$ERROR_LOG" </dev/null &!
  SERVICE_PID=$!

  READY=0
  for _ in {1..25}; do
    sleep 0.2
    if is_service_ready; then
      READY=1
      break
    fi
    if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
      break
    fi
  done

  if (( ! READY )); then
    show_error "LocalTeX 未能成功启动，请查看日志：$ERROR_LOG"
    exit 1
  fi
fi

if [[ "${LOCAL_TEX_NO_OPEN:-0}" != "1" ]]; then
  /usr/bin/open "$LOCAL_URL"
fi
