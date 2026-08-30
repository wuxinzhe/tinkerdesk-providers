/**
 * src/lib/engine.ts — IndexTTS-2.5 引擎封装：spawn Python 进程合成克隆语音
 *
 * 自包含环境（应用托管——不依赖系统）：
 *   - 项目: {userData}/runtime/speech-index-tts/app（uv sync 安装依赖——venv: .venv\Scripts\python.exe）
 *   - 模型: {userData}/runtime/speech-index-tts/checkpoints（modelscope 下载 IndexTTS-2.5——gpt.pth ~3.26G）
 *
 * 环境变量可覆盖（兼容旧 C:\tools 路径）：
 *   INDEX_TTS_DIR          项目根（默认 runtime/app）
 *   INDEX_TTS_VENV_PYTHON  venv python 路径（默认项目 .venv）
 */
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/** 自包含 runtime 根（initEngine 注入——由 configDir 向上推 {userData}/runtime） */
let runtimeRoot = ''
let PROJECT_DIR = process.env.INDEX_TTS_DIR || ''

/** 初始化引擎环境（插件 init 时调用——configDir = 插件目录，向上推 userData 根） */
export function initEngine(configDir: string): void {
  // configDir = {userData}/providers/speech-index-tts → userData = 上两级 → runtime = userData/runtime
  const userData = dirname(dirname(configDir))
  runtimeRoot = join(userData, 'runtime', 'speech-index-tts')
  PROJECT_DIR = process.env.INDEX_TTS_DIR || join(runtimeRoot, 'app')
}

/** 项目 venv python（环境变量优先，回退 Windows 惯例路径） */
function findPython(): string | undefined {
  const candidates = [
    process.env.INDEX_TTS_VENV_PYTHON,
    join(PROJECT_DIR, '.venv', 'Scripts', 'python.exe'),
    join(PROJECT_DIR, '.venv', 'python.exe'),
  ].filter((p): p is string => !!p)
  return candidates.find((p) => existsSync(p))
}

/** 模型是否就绪（config.yaml + gpt.pth 是关键文件） */
export function isModelReady(): boolean {
  return (
    existsSync(join(PROJECT_DIR, 'checkpoints', 'config.yaml')) &&
    existsSync(join(PROJECT_DIR, 'checkpoints', 'gpt.pth'))
  )
}

/** 环境探测：python + 模型 */
export function detectEnv(): { python: string | undefined; projectDir: string; script: string; ok: boolean } {
  const python = findPython()
  return {
    python,
    projectDir: PROJECT_DIR,
    script: join(__dirname, '..', '..', 'scripts', 'gen_index.py'),
    ok: !!python && isModelReady(),
  }
}

/** 合成选项 */
export interface SynthesizeOptions {
  text: string
  refAudio: string
  lang?: string
  durationFactor?: number
  emotionMode?: 'none' | 'audio' | 'vector'
  emoAudioPrompt?: string
  emotionPreset?: string
  emoAlpha?: number
  textNormalization?: boolean
  intervalSilence?: number
  useRandom?: boolean
  useBf16?: boolean
}

/**
 * 合成语音：spawn python → wav 文件 → 返回 wav 绝对路径
 * @returns {Promise<{ wavPath: string; ms: number }>}
 */
export async function synthesize(opts: SynthesizeOptions): Promise<{ wavPath: string; ms: number }> {
  const { text, refAudio } = opts
  const env = detectEnv()
  if (!env.ok) {
    throw new Error('IndexTTS 环境未就绪（需要 runtime/speech-index-tts 项目 + checkpoints 模型——见系统依赖步 AI 安装助手）')
  }
  if (!env.python) throw new Error('IndexTTS python 未找到')

  const outPath = join(tmpdir(), `indextts-${Date.now()}-${Math.floor(Math.random() * 10000)}.wav`)
  const payload = JSON.stringify({
    text,
    refAudio,
    lang: opts.lang || 'ZH',
    durationFactor: typeof opts.durationFactor === 'number' && opts.durationFactor > 0 ? opts.durationFactor : 1.0,
    emotionMode: opts.emotionMode || 'none',
    emoAudioPrompt: opts.emoAudioPrompt || undefined,
    emotionPreset: opts.emotionPreset || 'none',
    emoAlpha: typeof opts.emoAlpha === 'number' && opts.emoAlpha >= 0 ? opts.emoAlpha : 1.0,
    textNormalization: opts.textNormalization !== false,
    intervalSilence: typeof opts.intervalSilence === 'number' && opts.intervalSilence > 0 ? opts.intervalSilence : 200,
    useRandom: !!opts.useRandom,
    useBf16: opts.useBf16 !== false,
    outPath,
  })

  const started = Date.now()
  const result = await new Promise<{ ok: boolean; outPath?: string; error?: string }>((resolve, reject) => {
    const child = spawn(env.python!, [env.script], {
      cwd: env.projectDir, // import indextts 需要项目根
      env: {
        ...process.env,
        PYTHONPATH: env.projectDir,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.slice(-500) || `exit ${code}`))
      }
      try {
        // infer 内部 print 会污染 stdout（"327"、">> wav file saved to..."）——
        // JSON 结果在最后——提取含 {"ok" 的行（容错解析）
        const lines = stdout.trim().split('\n')
        const jsonLine = lines.find((l) => l.trim().startsWith('{"ok"')) ?? lines[lines.length - 1]
        resolve(JSON.parse(jsonLine.trim()))
      } catch {
        reject(new Error(`脚本输出解析失败: ${stdout.slice(-300)}`))
      }
    })
    child.on('error', reject)
    child.stdin.end(payload)
  })
  if (!result.ok) {
    throw new Error(result.error || '合成失败')
  }
  if (!result.outPath) throw new Error('合成未返回输出路径')
  return { wavPath: result.outPath, ms: Date.now() - started }
}

/** wav 文件 → data URL（音频气泡播放） */
export function wavToDataUrl(wavPath: string): string {
  const buf = readFileSync(wavPath)
  return `data:audio/wav;base64,${buf.toString('base64')}`
}