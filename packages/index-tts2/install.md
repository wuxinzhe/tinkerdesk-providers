# 安装 IndexTTS 运行时

> 安装目标：`{runtimeDir}/speech-index-tts/`（应用自包含目录——不检测系统 Python/环境是否已装，全部装到这里）
> 本文件由 AI 安装助手读取——所有下载/解压/安装动作都落在安装目标内。

## 前置条件

- 操作系统：Windows 10+ / macOS 12+ / Linux x64
- 硬件：NVIDIA GPU（推荐 8GB+ 显存——BF16 推理 16GB 显卡建议开启）；无 GPU 可用 CPU（慢）
- 已安装：无（自带 uv 工具由 AI 安装助手处理；Python 也装在自包含目录内）
- 磁盘：约 8GB 可用（项目依赖 ~2GB + 模型 ~5.1GB）

## 安装步骤

1. **创建自包含目录**
   ```bash
   mkdir -p "{runtimeDir}/speech-index-tts"
   cd "{runtimeDir}/speech-index-tts"
   ```

2. **下载/克隆 IndexTTS 项目源码**
   ```bash
   git clone https://github.com/index-tts/index-tts.git app
   cd app
   ```
   （如 git 不可用：下载 https://github.com/index-tts/index-tts/archive/refs/heads/main.zip 解压到 app/）

3. **安装 uv（Python 包管理器）——装到自包含目录**
   ```bash
   # Windows（PowerShell）：
   curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="{runtimeDir}/speech-index-tts/uv" sh
   # 或用 pip 装到自包含 venv（若已有 Python）：
   # python -m venv "{runtimeDir}/speech-index-tts/.venv"
   ```

4. **创建 venv + 安装依赖（uv sync）**
   ```bash
   cd "{runtimeDir}/speech-index-tts/app"
   "{runtimeDir}/speech-index-tts/uv/uv.exe" venv --python 3.10 "{runtimeDir}/speech-index-tts/.venv"
   "{runtimeDir}/speech-index-tts/uv/uv.exe" sync --active
   ```
   （venv python 最终路径：`{runtimeDir}/speech-index-tts/.venv/Scripts/python.exe`——引擎按此查找）

5. **下载 IndexTTS-2.5 模型到 checkpoints**
   ```bash
   cd "{runtimeDir}/speech-index-tts"
   "{runtimeDir}/speech-index-tts/uv/uv.exe" tool run modelscope download --model IndexTeam/IndexTTS-2.5 --local_dir checkpoints
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
