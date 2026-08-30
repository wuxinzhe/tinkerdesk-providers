/**
 * src/index.ts — tinkerdesk-provider-speech-index-tts 入口（TinkerDesk v2 OO 契约）
 *
 * 能力：voice.tts / tool.tts（IndexTTS-2.5 克隆你的声音朗读——中/英/日/西/阿）。
 * Note: IndexTTS 是纯 TTS（声音克隆），无 STT——STT 请使用 speech-sherpa 插件。
 *
 * 仿声配置（manifest configSchema）：
 *   voiceProfile    参考音色（wav/mp3 路径——5-10 秒清晰人声）
 *   lang            合成语言（ZH/EN/JA/ES/AR）
 *   speed           语速（>1 快 <1 慢——内部转 duration_factor=1/speed）
 *   emotionMode     情感控制（none / audio 情感参考音频 / vector 情感预设）
 *   emoAudioPrompt  情感参考音频（emotionMode=audio 时生效）
 *   emotionPreset   情感预设（emotionMode=vector 时生效）
 *   emoAlpha        情感强度 0-1
 *   textNormalization 文本归一化
 *   intervalSilence 长文本分段间隔静音 ms
 *   useRandom       随机采样
 *   bf16            BF16 推理（省显存）
 *
 * 契约：tts:speak({ text }) → { audio: dataURL }；tts:speak_file → { filePath }
 */
import { existsSync, copyFileSync } from 'fs'
import type { PluginCheckResult, PluginContext, TinkerProvider } from '../plugin-types'
import { synthesize, wavToDataUrl, detectEnv, isModelReady, initEngine } from './lib/engine'

/** 语速 → IndexTTS duration_factor（speed>1 快 → factor<1 时长短；clamp 0.5-2.0） */
function speedToFactor(speed: unknown): number {
  const s = typeof speed === 'number' && speed > 0 ? speed : 1.0
  const factor = 1 / s
  return Math.min(2.0, Math.max(0.5, factor))
}

interface TtsConfig {
  voiceProfile?: string
  lang?: string
  speed?: number
  emotionMode?: 'none' | 'audio' | 'vector'
  emoAudioPrompt?: string
  emotionPreset?: string
  emoAlpha?: number
  textNormalization?: boolean
  intervalSilence?: number
  useRandom?: boolean
  bf16?: boolean
}

/** 合成选项（从配置提取——传给引擎） */
function buildOptions(cfg: TtsConfig) {
  return {
    lang: typeof cfg.lang === 'string' && cfg.lang ? cfg.lang : 'ZH',
    durationFactor: speedToFactor(cfg.speed),
    emotionMode: cfg.emotionMode || 'none',
    emoAudioPrompt: typeof cfg.emoAudioPrompt === 'string' && cfg.emoAudioPrompt ? cfg.emoAudioPrompt : undefined,
    emotionPreset: cfg.emotionPreset || 'none',
    emoAlpha: typeof cfg.emoAlpha === 'number' && cfg.emoAlpha >= 0 ? cfg.emoAlpha : 1.0,
    textNormalization: cfg.textNormalization !== false,
    intervalSilence: typeof cfg.intervalSilence === 'number' && cfg.intervalSilence > 0 ? cfg.intervalSilence : 200,
    useRandom: !!cfg.useRandom,
    useBf16: cfg.bf16 !== false,
  }
}

export default class IndexTts2Provider implements TinkerProvider {
  private ctx!: PluginContext

  /** 参考音色校验（voiceProfile 必须存在且文件存在） */
  private readyVoice(): { ok: boolean; error?: string } {
    const cfg = this.ctx.getConfig<TtsConfig>()
    const ref = cfg.voiceProfile
    if (!ref || !existsSync(ref)) {
      return { ok: false, error: '未配置参考音色（voiceProfile）——请到配置页选择仿声音色' }
    }
    return { ok: true }
  }

  init(ctx: PluginContext): void {
    this.ctx = ctx
    initEngine(ctx.configDir)

    // ── TTS：用配置的仿声音色合成 ──
    ctx.registerIpc('tts:speak', async (payload) => {
      const p = payload as { text?: string }
      const text = p && typeof p.text === 'string' ? p.text.trim() : ''
      if (!text) throw new Error('tts:speak 需要 text')
      const voice = this.readyVoice()
      if (!voice.ok) throw new Error(voice.error)
      const cfg = this.ctx.getConfig<TtsConfig>()
      const { wavPath } = await synthesize({ text, refAudio: cfg.voiceProfile!, ...buildOptions(cfg) })
      return { audio: wavToDataUrl(wavPath), text }
    })

    // ── 工具 TTS（tool.tts 契约）：{ text, outputPath } → { filePath } ──
    ctx.registerIpc('tts:speak_file', async (payload) => {
      const p = payload as { text?: string; outputPath?: string }
      const text = p && typeof p.text === 'string' ? p.text.trim() : ''
      const outputPath = p && typeof p.outputPath === 'string' ? p.outputPath : ''
      if (!text) throw new Error('tts:speak_file 需要 text')
      if (!outputPath) throw new Error('tts:speak_file 需要 outputPath')
      const voice = this.readyVoice()
      if (!voice.ok) throw new Error(voice.error)
      const cfg = this.ctx.getConfig<TtsConfig>()
      const { wavPath } = await synthesize({ text, refAudio: cfg.voiceProfile!, ...buildOptions(cfg) })
      copyFileSync(wavPath, outputPath)
      return { filePath: outputPath }
    })

    // ── 模型管理：IndexTTS-2.5 模型状态 ──
    ctx.registerIpc('models:status', () => ({
      checkpoints: isModelReady(),
      allReady: isModelReady(),
    }))
    ctx.registerIpc('models:download', async () => {
      if (isModelReady()) return { ok: true, skipped: true }
      throw new Error(
        'IndexTTS 模型未就绪——请通过「系统依赖」步的 AI 安装助手引导下载（runtime/speech-index-tts/checkpoints）'
      )
    })
  }

  check(): PluginCheckResult {
    const env = detectEnv()
    if (!env.ok) {
      return {
        ok: false,
        checks: [{
          name: 'IndexTTS 环境',
          ok: false,
          hint: env.python
            ? '模型未就绪（需要 runtime/speech-index-tts/checkpoints）'
            : 'IndexTTS 环境未安装（需要 runtime/speech-index-tts 项目 + uv sync——见系统依赖步 AI 安装助手）',
        }],
      }
    }
    const voice = this.readyVoice()
    return {
      ok: voice.ok,
      checks: [{ name: '参考音色', ok: voice.ok, hint: voice.ok ? undefined : voice.error }],
    }
  }

  start(): void { /* 无常驻进程——合成按需 spawn */ }
  stop(): void { /* 无常驻进程 */ }
  dispose(): void { /* 无需释放 */ }
}