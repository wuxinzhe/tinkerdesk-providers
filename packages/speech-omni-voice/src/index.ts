/**
 * src/index.ts — tinkerdesk-provider-speech-omni-voice 入口（TinkerDesk v2 OO 契约）
 *
 * 能力：voice.tts（用 OmniVoice 克隆你的声音朗读）。
 * Note: OmniVoice 是纯 TTS（声音克隆），无 STT——STT 请使用 speech-sherpa 插件，
 * 语音设置里可为每个接口选择不同的 provider。
 *
 * 仿声配置（manifest configSchema）：
 *   voiceProfile  参考音色（wav 路径）
 *   refText       参考音频文本（可空，空则 Whisper 自动转写）
 *   speed         语速（当前版本不变速，保留字段）
 *
 * 契约：tts:speak({ text }) → { audio: dataURL }；tts:speak_file → { filePath }
 */
import { existsSync, copyFileSync } from 'fs'
import type { PluginCheckResult, PluginContext, TinkerProvider } from '../plugin-types'
import { synthesize, wavToDataUrl, detectEnv, isModelReady, downloadModels } from './lib/omni'

interface OmniConfig {
  voiceProfile?: string
  refText?: string
  speed?: number
}

export default class OmniVoiceProvider implements TinkerProvider {
  private ctx!: PluginContext

  init(ctx: PluginContext): void {
    this.ctx = ctx

    // ── TTS：用配置的仿声音色合成 ──
    ctx.registerIpc('tts:speak', async (payload) => {
      const p = payload as { text?: string }
      const text = p && typeof p.text === 'string' ? p.text.trim() : ''
      if (!text) throw new Error('tts:speak 需要 text')
      const cfg = this.ctx.getConfig<OmniConfig>()
      const refAudio = cfg.voiceProfile
      if (!refAudio || !existsSync(refAudio)) {
        throw new Error('未配置参考音色（voiceProfile），请到配置页选择仿声音色')
      }
      const { wavPath } = await synthesize({
        pluginDir: ctx.configDir,
        text,
        refAudio,
        refText: typeof cfg.refText === 'string' && cfg.refText.trim() ? cfg.refText.trim() : null,
      })
      return { audio: wavToDataUrl(wavPath), text }
    })

    // ── 工具 TTS（tool.tts 契约）：{ text, outputPath } → { filePath } ──
    ctx.registerIpc('tts:speak_file', async (payload) => {
      const p = payload as { text?: string; outputPath?: string }
      const text = p && typeof p.text === 'string' ? p.text.trim() : ''
      const outputPath = p && typeof p.outputPath === 'string' ? p.outputPath : ''
      if (!text) throw new Error('tts:speak_file 需要 text')
      if (!outputPath) throw new Error('tts:speak_file 需要 outputPath')
      const cfg = this.ctx.getConfig<OmniConfig>()
      const refAudio = cfg.voiceProfile
      if (!refAudio || !existsSync(refAudio)) {
        throw new Error('未配置参考音色（voiceProfile），请到配置页选择仿声音色')
      }
      const { wavPath } = await synthesize({
        pluginDir: ctx.configDir,
        text,
        refAudio,
        refText: typeof cfg.refText === 'string' && cfg.refText.trim() ? cfg.refText.trim() : null,
      })
      if (wavPath !== outputPath) {
        copyFileSync(wavPath, outputPath)
      }
      return { filePath: outputPath }
    })

    // ── 模型管理：OmniVoice 模型下载（hf-mirror） ──
    ctx.registerIpc('models:status', () => ({
      OmniVoice: isModelReady(ctx.configDir),
      allReady: isModelReady(ctx.configDir),
    }))
    ctx.registerIpc('models:download', async () => {
      await downloadModels({ pluginDir: ctx.configDir, onProgress: (evt) => ctx.emit('models:progress', evt) })
      return { ok: true }
    })
  }

  check(): PluginCheckResult {
    const cfg = this.ctx.getConfig<OmniConfig>()
    const modelOk = isModelReady(this.ctx.configDir)
    const pyOk = !!detectEnv(this.ctx.configDir).python
    const hasProfile = typeof cfg.voiceProfile === 'string' && cfg.voiceProfile.length > 0 && existsSync(cfg.voiceProfile)
    const hasRefText = typeof cfg.refText === 'string' && cfg.refText.trim().length > 0
    const checks = [
      {
        name: 'OmniVoice 模型',
        ok: modelOk,
        hint: modelOk ? undefined : 'OmniVoice 模型未下载（约 2GB，hf-mirror）',
        action: modelOk ? undefined : 'download-models' as const,
      },
      {
        name: 'Python 环境',
        ok: pyOk,
        hint: pyOk ? undefined : '未检测到 Python venv（C:\\tools\\omnivoice\\.venv）',
        action: pyOk ? undefined : 'open-config' as const,
      },
      {
        name: '参考音色',
        ok: hasProfile,
        hint: cfg.voiceProfile && !existsSync(cfg.voiceProfile)
          ? `参考音频不存在: ${cfg.voiceProfile}`
          : '未选择仿声音色（参考音频 wav）',
        action: hasProfile ? undefined : 'open-config' as const,
      },
      {
        name: '参考音频原文',
        ok: hasRefText,
        hint: hasRefText ? undefined : '未填写参考音频原文（本机 Whisper 离线不可用，必须手动填）',
        action: hasRefText ? undefined : 'open-config' as const,
      },
    ]
    return { ok: checks.every((c) => c.ok), checks }
  }

  start(): void { /* 无常驻进程 */ }
  stop(): void { /* 无常驻进程 */ }
  dispose(): void { /* 无需释放 */ }
}