# 🖥️ 桌面版说明

用 Python 把网页游戏封装成**桌面窗口程序**,支持 macOS / Windows / Linux。

## 架构

```
desktop/app.py      启动器:起本地服务器 → pywebview 打开原生游戏窗口
desktop/server.py   零依赖服务器(纯 Python 标准库):
                    HTTP 静态托管 + WebSocket 联机,协议与 Node 版 server.js 完全一致
```

- **不需要 Node.js**:联机服务器已用 Python 标准库重写,装个 Python 就能开黑
- 未安装 pywebview 时自动回退到系统浏览器打开,游戏照常可玩
- 局域网好友可直接访问 `http://<你的IP>:8081` 加入对战

## 安装与运行

```bash
# 1. 安装桌面窗口支持(可选,不装则用浏览器模式)
pip install -r desktop/requirements.txt

# 2. 启动
python3 desktop/app.py            # macOS / Linux
python desktop\app.py             # Windows
# 或者 macOS 直接双击 start_mac.command / Windows 双击 start_windows.bat
```

换端口:`PORT=9090 python3 desktop/app.py`

## 打包成免安装可执行文件(可选)

```bash
pip install pyinstaller
# macOS 生成 .app:
pyinstaller --windowed --name 火柴人机枪大战 \
  --add-data "index.html:." --add-data "css:css" --add-data "js:js" \
  desktop/app.py
# Windows 生成 exe(--add-data 分隔符用分号):
pyinstaller --windowed --name 火柴人机枪大战 ^
  --add-data "index.html;." --add-data "css;css" --add-data "js;js" ^
  desktop\app.py
```

产物在 `dist/火柴人机枪大战/`,整包拷给别人即可运行。

## 常见问题

- **macOS 双击 .command 提示无法打开**:系统设置 → 隐私与安全性 → 仍要打开
- **Windows 提示找不到 python**:先安装 Python 3.9+(勾选 "Add to PATH")
- **端口被占用**:`PORT=9090 python3 desktop/app.py`
