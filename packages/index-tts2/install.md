# 安装 IndexTTS 运行时

> 安装目标：`{runtimeDir}/speech-index-tts/`（应用自包含目录——不检测系统 Python/环境是否已装，全部装到这里）
> 本文件由 AI 安装助手读取——基础设施（uv/python）管理与分级原则见 **butler-runtime 技能**，本文件只写本扩展的具体步骤。

## 前置条件

- 操作系统：Windows 10+ / macOS 12+ / Linux x64
- 硬件：NVIDIA GPU（推荐 8GB+ 显存——BF16 推理 16GB 显卡建议开启）；无 GPU 可用 CPU（慢）
- 环境（管家第一步检测——缺失则系统全局安装，不随本扩展卸载）：
  - `git`（克隆源码）
  - `uv`（Python 包管理 + 运行时）
  - `python` 3.10（运行时——可由 uv 管理）
- 磁盘：约 8GB 可用（项目依赖 ~2GB + 模型 ~5.1GB）

## 安装步骤

1. **环境检测**（管家第一步——install.md 通用流程）
   ```bash
   runtime_status              # 检测 git/uv/python 是否在 PATH
   runtime_ensure({kind: "git"})      # 缺失 → 系统全局安装
   runtime_ensure({kind: "uv"})       # 缺失 → 系统全局安装
   runtime_ensure({kind: "python", version: "3.10"})
   ```
   （环境就绪后继续——基础设施系统全局，卸载扩展不碰）

2. **创建自包含目录**
   ```bash
   mkdir -p "{runtimeDir}/speech-index-tts"
   cd "{runtimeDir}/speech-index-tts"
   ```

3. **下载/克隆 IndexTTS 项目源码**
   ```bash
   git clone https://github.com/index-tts/index-tts.git app
   cd app
   ```
   （如 git 不可用：下载 https://github.com/index-tts/index-tts/archive/refs/heads/main.zip 解压到 app/——git 用系统自带，不自包含）

4. **创建 venv + 安装依赖（uv sync——uv/python 用 PATH 系统全局）**
   ```bash
   cd "{runtimeDir}/speech-index-tts/app"
   uv venv --python python3.10 "{runtimeDir}/speech-index-tts/.venv"
   uv sync --active
   ```
   （venv python 最终路径：`{runtimeDir}/speech-index-tts/.venv/Scripts/python.exe`（Windows）/ `.venv/bin/python`（macOS/Linux）——引擎按此查找）

5. **下载 IndexTTS-2.5 模型到 checkpoints**
   ```bash
   cd "{runtimeDir}/speech-index-tts"
   uv tool run modelscope download --model IndexTeam/IndexTTS-2.5 --local_dir checkpoints
   ```
   （约 5.1GB——模型含 config.yaml + gpt.pth ~3.26G，需耐心等待；失败可重试）

## 验证

安装完成后执行：

```bash
ls "{runtimeDir}/speech-index-tts/app/.venv/Scripts/python.exe"  # venv 存在
ls "{runtimeDir}/speech-index-tts/checkpoints/gpt.pth"            # 模型存在
ls "{runtimeDir}/speech-index-tts/checkpoints/config.yaml"        # 模型配置存在
```

预期输出：三个路径都存在（无 No such file 错误）。

全部就绪后告诉用户「IndexTTS 运行时安装完成」。

## 常见问题

- **uv sync 失败（网络/依赖）** → 重试一次；仍失败换镜像源：`UV_DEFAULT_INDEX=https://mirrors.aliyun.com/pypi/simple/`
- **modelscope 下载慢/中断** → 重试（支持断点续传）；或换 hf-mirror：`modelscope download` 重跑即可
- **GPU 显存不足** → 合成时开启 BF16（应用配置 `bf16: true`）；仍不足换更小模型
- **venv python 找不到** → 确认步骤 4 的 venv 创建成功，检查 `{runtimeDir}/speech-index-tts/.venv/Scripts/python.exe`
- **uv 缓存占用大** → `runtime_clean_cache({kind: "uv"})` 或引导用户 `uv cache clean`（缓存是系统全局的——不随扩展卸载）
