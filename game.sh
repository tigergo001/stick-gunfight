#!/usr/bin/env bash
# ============================================================
#   火柴人机枪大战 —— 一键启动 / 停止服务器
#
#   用法:
#     ./game.sh            # 启动(默认),自动打开浏览器
#     ./game.sh start      # 同上
#     ./game.sh stop       # 停止服务器
#     ./game.sh restart    # 重启
#     ./game.sh status     # 查看运行状态
#
#   换端口:  PORT=9090 ./game.sh start
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"
PID_FILE="$DIR/.server.pid"
LOG_FILE="$DIR/server.log"
URL="http://localhost:$PORT"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

port_busy() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

open_browser() {
  if [ "${NO_OPEN:-0}" != "1" ] && command -v open >/dev/null 2>&1; then
    open "$URL" 2>/dev/null || true
  fi
}

wait_ready() {
  # 最多等 5 秒直到 HTTP 有响应
  for _ in $(seq 1 25); do
    if curl -s -o /dev/null -m 1 "$URL"; then return 0; fi
    sleep 0.2
  done
  return 1
}

start() {
  if is_running; then
    echo "✅ 服务器已在运行 (PID $(cat "$PID_FILE")) → $URL"
    open_browser
    return 0
  fi
  if port_busy; then
    echo "⚠️  端口 $PORT 已被其他程序占用" >&2
    echo "   换个端口: PORT=9090 $0 start" >&2
    echo "   或先停止: $0 stop" >&2
    exit 1
  fi
  echo "🚀 启动服务器…"
  cd "$DIR"
  nohup node server.js >"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  if wait_ready; then
    echo "✅ 已启动 (PID $(cat "$PID_FILE"))"
    echo "   游戏地址: $URL"
    echo "   运行日志: $LOG_FILE  (停止: $0 stop)"
    open_browser
  else
    echo "❌ 启动失败,最近日志:" >&2
    tail -20 "$LOG_FILE" >&2
    stop >/dev/null 2>&1 || true
    exit 1
  fi
}

stop() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "🛑 停止服务器 (PID $pid)…"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "   未响应,强制结束"
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "✅ 已停止"
    return 0
  fi
  rm -f "$PID_FILE"
  # 没有 PID 记录(比如上次不是用脚本启动的):兜底清理占用端口的进程
  if port_busy; then
    local pids
    pids="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN | tr '\n' ' ')"
    echo "🛑 发现端口 $PORT 被占用 (PID: $pids),正在停止…"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.3
    echo "✅ 已停止"
  else
    echo "ℹ️  服务器未在运行"
  fi
}

status() {
  if is_running; then
    echo "✅ 运行中 (PID $(cat "$PID_FILE")) → $URL"
  elif port_busy; then
    echo "⚠️  端口 $PORT 有进程在监听,但不是本脚本启动的 (可用 $0 stop 停止)"
  else
    echo "⭕ 未运行 (启动: $0 start)"
  fi
}

case "${1:-start}" in
  start)          start ;;
  stop)           stop ;;
  restart)        stop; echo; start ;;
  status)         status ;;
  -h|--help|help) sed -n '2,14p' "$0" ;;
  *) echo "未知命令: $1 (可用: start | stop | restart | status)" >&2; exit 1 ;;
esac
