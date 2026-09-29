#!/bin/bash
# macOS 双击启动 火柴人机枪大战(桌面版)
cd "$(dirname "$0")" || exit 1
exec python3 desktop/app.py
