# LocalTeX (macOS)

LocalTeX 是一个本地优先的 LaTeX 写作工作台。它既可以只在本机使用，也可以在可信局域网中通过安全分享链接进行多人实时协作。

当前为 `mac` 分支，针对 macOS（Apple Silicon / Intel）进行了原生适配。本项目由 hiahei 设计与维护，使用 OpenAI Codex 辅助开发。

## 当前功能

- Project file browser（支持原生 macOS Finder 选择文件夹与 `.tex` 主文档）
- Text editing for `.tex`, `.bib`, `.sty`, `.cls`, and other text files
- 使用 `⌘S` 保存并编译，`⌘F` 查找，`⌥Z` 切换自动换行
- 无工具栏、全尺寸 PDF 预览（支持触控板双指捏合与 `⌘ + 滚轮` 缩放、`⌥ + 单击` 源码 ⇄ PDF 双向定位）
- Compile log and extracted LaTeX diagnostics
- Image and project-file upload
- 局域网多人实时编辑、在线成员显示和自动保存
- 带随机访问令牌的局域网鉴权
- 复用主机本地配置、支持权限切换的 Codex 写作与编译助手
- 项目文件始终保存在主机磁盘；只有主动调用 Codex 时，所选上下文才会交给 Codex

## Codex 助手

编辑页右侧提供独立的 Codex 抽屉（快捷键 `⌃⌥C`），可分析编译日志、解释 LaTeX、润色选区或检查当前文件；抽屉关闭后不占用编辑器或 PDF 预览空间。LocalTeX 使用主机已有的 `CODEX_HOME`（默认 `~/.codex`）、登录状态、模型和推理配置，不在网页、`data` 或论文目录中复制 API Key。修改本机 Codex 配置后，重新启动 LocalTeX 服务即可生效。

Codex 消息中的 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 及常用公式环境会由随项目安装的 KaTeX 在本地渲染；代码块不会被当成公式处理，复制渲染结果时仍会保留对应的 TeX 源码。

当前版本采用以下权限边界：

- 只有通过 `127.0.0.1` 访问的主机可以调用 Codex，局域网协作者看不到主机配置。
- 主机可在编辑页底部选择“只读”“项目可写”或“Full access”，设置保存在本机 `data/codex-settings.json`，适用于之后的新建和续聊任务。
- 模型入口默认跟随主机 `config.toml`；也可以从当前登录账号的 Codex 可用模型列表中覆盖选择。模型选择同样只保存在本机 `data/codex-settings.json`，下一次任务生效。
- “只读”不会修改文件；“项目可写”允许修改线程工作区；“Full access”允许访问工作区外的文件、执行系统命令，并开启命令网络访问和实时网页搜索。
- 所有模式均采用非交互运行；开启 Full access 后应在提示词中明确操作范围，并谨慎处理删除、覆盖和其他难以恢复的操作。
- 当前文件、选区和编译日志分别由用户勾选并作为直接上下文；为了解决跨文件的 LaTeX 问题，Codex 会在所选历史原本的工作区继续运行。
- “停止”按钮会中断当前任务，同一个项目同时只运行一个 Codex 任务。

首次使用前应确保本机 Codex 已经登录：

```zsh
codex login status
```

本地登录既可以使用 ChatGPT，也可以使用 API Key；具体计费和数据策略由现有 Codex 登录方式及所属 OpenAI 工作区决定。

## macOS 运行环境准备

1. **Node.js (`>= 20`)**：支持通过 Homebrew（`brew install node`）、`nvm`、`fnm` 或 `volta` 安装；从 Finder 双击启动时启动器会自动探测这些常见安装位置。
2. **LaTeX 编译器**（任选其一，服务端会自动探测 `/Library/TeX/texbin`、`~/Library/TinyTeX`、`/opt/homebrew/bin`、`/usr/local/bin` 等目录）：
   - **轻量安装（推荐快速上手）**：
     ```zsh
     brew install tectonic
     ```
     LocalTeX 内置了对 `.synctex.gz` 的原生解析支持，仅安装 `tectonic` 即可完整使用干净编译、BibTeX 与源码 ⇄ PDF 双向定位。
   - **完整 TeX Live / MacTeX 环境**：
     ```zsh
     brew install --cask mactex-no-gui
     ```
     安装 MacTeX、BasicTeX 或 TinyTeX 后，LocalTeX 会优先使用 `pdflatex` / `latexmk` 与原生 `synctex` 工具。

从 GitHub 新克隆源码后，先在项目根目录恢复 JavaScript 依赖：

```zsh
npm ci
```

`workspace` 和 `data` 包含论文及本机运行信息，不进入 Git。首次启动时，LocalTeX 会自动创建空工作区和新的本机配置；随后可在主页添加论文目录。

## 启动与停止

推荐直接在 Finder 中双击无窗口启动入口（静默启动后台控制器并打开浏览器，不保留常驻终端窗口）：

```text
LocalTeX.app
```

也可以双击兼容脚本或在终端中运行：

```zsh
./launch-localtex.sh
# 或双击 start-local.command
```

启动器会在后台运行轻量主机控制器，并打开 `http://127.0.0.1:4177`。正常操作全部在“主机与协作控制”页面完成：工作服务可以暂停或恢复，局域网分享可以独立开启或关闭。暂停工作服务时，文件、编译、上传和协作接口全部锁定，但控制页仍然在线。每次重新启动控制器时，本地工作服务都会自动开启，局域网分享都会强制关闭。

只有需要完全退出后台主机控制器时才运行停止脚本：

```zsh
./stop-localtex.sh
```

开发调试时也可以运行下面的命令（该方式默认只监听 `127.0.0.1`，不支持从页面动态开启局域网分享）：

```zsh
npm start
```

## 局域网协作

1. 双击 `LocalTeX.app`（或运行 `./launch-localtex.sh`）打开 LocalTeX。
2. 在项目首页点击“协作分享”，或进入编辑器后点击右上角“仅本机 / 协作”状态按钮。
3. 在“主机与协作控制”中确认工作服务已开启，然后点击“开启分享”。
4. 点击“复制链接”，把完整链接发给同一局域网内的可信成员。
5. 对方打开链接并选择项目、文件后即可实时编辑；顶部会显示在线人数。
6. 不需要协作时点击“关闭分享”，远端页面和实时连接会立即失效。

再次开启时原安全链接可以继续使用，无需反复发送新链接。安全令牌保存在 `data/lan-settings.json`，但每次重新启动控制器都会强制关闭分享，必须由主机再次手动开启。

如果开启分享后同一局域网内的其他设备无法访问：

- 检查 **系统设置 → 网络 → 防火墙**：若已开启 macOS 防火墙，请在系统首次询问“是否允许 `node` 接收传入网络连接”时点击“允许”，或在防火墙选项中允许当前 Node 可执行文件。
- 确认两台设备连接在同一个局域网（未开启访客网络隔离）。LocalTeX 会自动优先选择物理局域网地址并排后 `utun` 等代理/VPN 虚拟网卡。
- 不要在酒店、机场等不可信公共网络上开启局域网模式。

如需更换访问令牌，请先运行 `./stop-localtex.sh` 停止服务，删除 `data/lan-settings.json`，再重新启动并开启分享。

## Project list and local files

LocalTeX opens on a project list. Use one of these actions:

- **打开项目文件夹**: 通过 macOS Finder 选择任意包含 LaTeX 项目的本地文件夹。
- **导入 .zip（或直接拖入页面）**: 点击「导入 .zip」或直接把 Overleaf / arXiv 下载的 `.zip` 压缩包拖入页面，系统会自动安全解压到 `./workspace/<项目名>`（自动剥离单层套壳文件夹并过滤 `__MACOSX`）并打开主 `.tex` 文件。在编辑页内也可以直接将图片、`.bib`、`.tex` 等文件拖入左侧文件栏完成上传。
- **打开 .tex 文件**: 通过 macOS Finder 选择主 `.tex` 文件，其所在目录将作为项目根目录。
- **输入本地路径**: 直接粘贴完整文件夹路径（例如 `/Users/yourname/Documents/paper`）。

The list remembers each project path, main document, creation time, and last-opened time in `data/projects.json`. Removing an item from the list never deletes the original project folder or files.

## Use an existing paper

可以将论文项目放入默认私有目录 `./workspace`（已被 Git 忽略），也可以直接通过主页的“打开项目文件夹”添加任意位置的论文目录，或在调试启动前指定环境变量：

```zsh
LOCAL_TEX_WORKSPACE="/Users/yourname/path/to/paper" npm start
```

## 主机控制器与工作服务

后台控制器只负责本机控制页面。工作服务暂停时会自动关闭分享、断开协作者，并对文件、项目、上传、编译、PDF 和 WebSocket 接口加锁；控制器本身不向局域网开放。主机始终从 `127.0.0.1` 控制暂停/恢复与分享状态。暂停状态只在当前控制器进程内有效；下次启动会恢复本地工作服务，同时保持局域网分享关闭。
