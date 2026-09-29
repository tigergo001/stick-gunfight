#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
火柴人机枪大战 · 桌面版启动器

优先使用 pywebview 打开原生窗口(macOS 用 WebKit / Windows 用 WebView2);
未安装 pywebview 时自动回退为浏览器模式,游戏照常可玩。

用法:
  python3 desktop/app.py              # 默认端口 8081,打开桌面窗口
  PORT=9090 python3 desktop/app.py    # 指定端口
  HEADLESS=1 python3 desktop/app.py   # 只启动服务器不弹窗(自动化测试用)

安装桌面窗口支持:  pip install -r desktop/requirements.txt
"""
import io
import os
import sys
import threading
import time
import webbrowser

# 兼容旧版 Python 的管道输出编码(避免 emoji 打印崩溃)
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402  desktop/server.py

PORT = int(os.environ.get('PORT', '8081'))


def main():
    httpd = server.make_server(PORT)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = 'http://localhost:%d/' % PORT
    print('🔥 火柴人机枪大战 · Stick Gunfight(桌面版)')
    print('   游戏地址:', url)
    print('   好友联机: 同一局域网访问 http://<你的IP>:%d 并加入相同房间' % PORT)

    if os.environ.get('HEADLESS') == '1':
        print('HEADLESS 模式:服务器持续运行中(Ctrl+C 退出)')
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return 0

    try:
        import webview  # pywebview
    except ImportError:
        print('ℹ️ 未安装 pywebview,已回退到浏览器模式。'
              '安装后可获得独立桌面窗口:  pip install -r desktop/requirements.txt')
        webbrowser.open(url)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return 0

    webview.create_window(
        '🔥 火柴人机枪大战 · Stick Gunfight',
        url,
        width=1600, height=900, min_size=(960, 600),
        background_color='#070a10',
    )
    webview.start()
    return 0


if __name__ == '__main__':
    sys.exit(main())
