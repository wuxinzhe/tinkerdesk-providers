/**
 * src/lib/omni.ts — OmniVoice 引擎封装：spawn Python 进程合成克隆语音
 *
 * 模型位置（按优先级）：
 *   1. 插件目录 models/OmniVoice（插件自行下载，本插件提供 models:download）
 *   2. 本机预装 C:\tools\omnivoice\models\OmniVoice（OmniVoice 部署环境）
 *
 * 依赖（用户本机环境）：
 *   - Python venv: C:\tools\omnivoice\.venv\Scripts\python.exe
 */
import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream, statSync, readFileSync } from 'fs'
import { pipeline } from 'stream/promises'
import https from 'https'
import { tmpdir } from 'os'

/** OmniVoice 模型必需文件（相对模型目录；音频 tokenizer 在子目录） */
const MODEL_FILES = [
  'config.json',
  'model.safetensors',
  'tokenizer.json',
  'tokenizer_config.json',
  join('audio_tokenizer', 'config.json'),
  join('audio_tokenizer', 'model.safetensors'),
  join('audio_tokenizer', 'preprocessor_config.json'),
] as const

/** 模型源（按顺序尝试；hf-mirror 国内镜像优先，原始 HF 兜底） */
const MODEL_SOURCES = [
  'https://hf-mirror.com/k2-fsa/OmniVoice/resolve/main/',
  'https://huggingface.co/k2-fsa/OmniVoice/resolve/main/',
]

/** 本机 Python venv：环境变量优先（跨平台），回退 Windows 默认路径 */
function findPython(): string | undefined {
  const candidates = [
    process.env.OMNI_VENV_PYTHON,
    process.env.OMNI_VENV ? join(process.env.OMNI_VENV, 'bin', 'python') : undefined,
    'C:\\tools\\omnivoice\\.venv\\Scripts\\python.exe',
    'C:\\tools\\omnivoice\\.venv\\python.exe',
  ].filter((p): p is string => !!p)
  return candidates.find((p) => existsSync(p))
}

/** 模型目录：插件目录优先，回退本机预装（环境变量 OMNI_MODEL_DIR 可覆盖） */
function resolveModelDir(pluginDir: string): string {
  const local = join(pluginDir, 'models', 'OmniVoice')
  if (existsSync(join(local, 'model.safetensors'))) return local
  const preinstalled = process.env.OMNI_MODEL_DIR || 'C:\\tools\\omnivoice\\models\\OmniVoice'
  if (existsSync(join(preinstalled, 'model.safetensors'))) return preinstalled
  return local // 都不存在 → 插件目录（下载目标）
}

/** 模型是否就绪 */
export function isModelReady(pluginDir: string): boolean {
  const dir = resolveModelDir(pluginDir)
  return MODEL_FILES.every((f) => existsSync(join(dir, f)))
}

/** 环境探测：python + 模型 */
export function detectEnv(pluginDir: string): { python: string | undefined; modelDir: string; script: string; ok: boolean } {
  const python = findPython()
  return {
    python,
    modelDir: resolveModelDir(pluginDir),
    script: join(__dirname, '..', '..', 'scripts', 'gen_speech.py'),
    ok: !!python && isModelReady(pluginDir),
  }
}

/** 下载进度事件参数 */
export interface ModelProgressEvt {
  kind: string
  phase: string
  percent: number
  hint?: string
}

/**
 * 下载缺失模型文件到插件目录 models/OmniVoice（多源回退 + 断点续传 + 30s 超时）
 */
export async function downloadModels(opts: { pluginDir: string; onProgress: (evt: ModelProgressEvt) => void }): Promise<{ ok: boolean; skipped: boolean }> {
  const { pluginDir, onProgress } = opts
  if (isModelReady(pluginDir)) {
    onProgress({ kind: 'omni-model', phase: 'done', percent: 100 })
    return { ok: true, skipped: true }
  }
  const targetDir = join(pluginDir, 'models', 'OmniVoice')
  const tokenizerDir = join(targetDir, 'audio_tokenizer')
  mkdirSync(tokenizerDir, { recursive: true })

  let done = 0
  const total = MODEL_FILES.length
  for (const rel of MODEL_FILES) {
    if (existsSync(join(targetDir, rel))) {
      done += 1
      onProgress({ kind: 'omni-model', phase: 'download', percent: Math.round((done / total) * 100) })
      continue
    }
    const dest = join(targetDir, rel)
    const relPath = rel.split('\\').join('/')
    let lastErr: unknown = null
    for (let si = 0; si < MODEL_SOURCES.length; si++) {
      const url = MODEL_SOURCES[si] + relPath
      try {
        await downloadFile(url, dest, (p) => {
          onProgress({ kind: 'omni-model', phase: 'download', percent: Math.round(((done + p / 100) / total) * 100) })
        })
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        if (si < MODEL_SOURCES.length - 1) {
          onProgress({ kind: 'omni-model', phase: 'download', percent: 1, hint: '源切换（镜像不可用）…' })
        }
      }
    }
    if (lastErr) throw lastErr
    done += 1
    onProgress({ kind: 'omni-model', phase: 'download', percent: Math.round((done / total) * 100) })
  }
  if (!isModelReady(pluginDir)) {
    throw new Error('OmniVoice 模型下载后校验失败（缺少必需文件）')
  }
  onProgress({ kind: 'omni-model', phase: 'done', percent: 100 })
  return { ok: true, skipped: false }
}

/** 带进度 + 重定向跟随 + 断点续传 + 30s 超时（防卡死）的下载 */
function downloadFile(url: string, dest: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = (targetUrl: string, start: number): void => {
      const headers = start > 0 ? { Range: `bytes=${start}-` } : {}
      const req = https
        .get(targetUrl, { headers }, (res) => {
          const status = res.statusCode
          if (status && status >= 301 && status <= 308) {
            res.resume()
            const next = res.headers.location
            if (!next) return reject(new Error('重定向缺少 Location'))
            return request(new URL(next, targetUrl).toString(), start)
          }
          if (status !== 200 && status !== 206) {
            return reject(new Error(`下载失败 HTTP ${status}: ${targetUrl}`))
          }
          const size = parseInt(res.headers['content-length'] || '0', 10) + (status === 206 ? start : 0)
          let downloaded = 0
          const ws = createWriteStream(dest, { flags: start > 0 ? 'a' : 'w' })
          ws.on('error', reject)
          res.on('data', (chunk) => {
            downloaded += chunk.length
            if (size > 0) onProgress(Math.min(99, Math.round((downloaded / size) * 100)))
          })
          pipeline(res, ws).then(() => resolve()).catch(reject)
        })
        .on('error', reject)
      req.setTimeout(30000, () => req.destroy(new Error(`下载超时（30s 无响应）: ${targetUrl}`)))
    }
    request(url, existsSync(dest) ? statSync(dest).size : 0)
  })
}

/** 合成选项 */
export interface SynthesizeOptions {
  pluginDir: string
  text: string
  refAudio: string
  refText?: string | null
}

/**
 * 合成语音：spawn python → wav 文件 → 返回 wav 绝对路径
 */
export async function synthesize(opts: SynthesizeOptions): Promise<{ wavPath: string; ms: number }> {
  const { pluginDir, text, refAudio, refText } = opts
  const env = detectEnv(pluginDir)
  if (!env.ok) throw new Error('OmniVoice 模型或 Python 环境未就绪（请先下载模型/检查 venv）')
  if (!env.python) throw new Error('OmniVoice Python 未找到')

  const outPath = join(tmpdir(), `omni-${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`)
  const payload = JSON.stringify({ text, refAudio, refText: refText ?? null, outPath, modelDir: env.modelDir })

  const started = Date.now()
  const result = await new Promise<{ ok: boolean; outPath?: string; error?: string }>((resolve, reject) => {
    const child = spawn(env.python!, [env.script], {
      env: {
        ...process.env,
        PYTHONPATH: '', // 铁律：清空全局 PYTHONPATH（Hermes venv 污染）
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => reject(new Error(`Python 启动失败: ${(e as Error).message}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`OmniVoice 合成失败: ${stderr.trim() || stdout.trim() || `exit ${code}`}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as { ok: boolean; outPath?: string; error?: string }
        if (!parsed.ok) {
          reject(new Error(`OmniVoice 合成失败: ${parsed.error}`))
          return
        }
        resolve(parsed)
      } catch {
        reject(new Error(`OmniVoice 输出解析失败: ${stdout.trim().slice(0, 200)}`))
      }
    })
    child.stdin.write(payload)
    child.stdin.end()
  })

  if (!result.outPath) throw new Error('OmniVoice 合成未返回输出路径')
  return { wavPath: result.outPath, ms: Date.now() - started }
}

/** wav 文件 → base64 data URL（由插件 tts:speak 返回给 renderer Audio 播放） */
export function wavToDataUrl(wavPath: string): string {
  const buf = readFileSync(wavPath)
  return `data:audio/wav;base64,${buf.toString('base64')}`
}