/**
 * src/index.ts — TinkerDesk 适配层入口（TinkerDesk v2 OO 契约）
 *
 * 本文件只做协议翻译，业务逻辑全部在 core/（平台无关核心，CJS）：
 *   - ctx.registerIpc(...) → core.createSpeechService(...) 的能力
 *   - TinkerProvider（check/start/stop/dispose）→ core 同构
 *
 * 能力：
 *   stt:transcribe {samples, sampleRate} → {text}
 *   tts:speak {text} → {audio}
 *   models:status / models:download
 * 事件：models:progress {kind, phase, percent}
 */
import { PluginCheckResult, PluginContext, PluginStatus, TinkerProvider } from '../plugin-types'
import { createSpeechService } from './core'

export default class SpeechSherpaProvider implements TinkerProvider {
  private ctx!: PluginContext
   
  private speech: any

  init(ctx: PluginContext): void {
    this.ctx = ctx
    // 平台无关核心：模型目录 = <configDir>/models/<kind>（应用托管）
    this.speech = createSpeechService({
      configDir: ctx.configDir,
      manifest: ctx.getManifest(),
      emit: (evt: unknown) => ctx.emit('models:progress', evt),
    })

    // ── STT：应用录音完成后调此接口转文本 ──
    ctx.registerIpc('stt:transcribe', (payload) => {
      if (!this.speech.models.isReady('stt')) {
        throw new Error('STT 模型未就绪，请先在插件设置中下载模型')
      }
      const p = payload as { samples?: Float32Array }
      const samples = p?.samples
      if (!(samples instanceof Float32Array) || samples.length === 0) {
        throw new Error('stt:transcribe 需要 samples（Float32Array 16kHz）')
      }
      const text = this.speech.stt.transcribe(samples)
      return { text }
    })

    // ── TTS：文本合成语音（返回 audio data URL） ──
    ctx.registerIpc('tts:speak', async (payload) => {
      const p = payload as { text?: string }
      const text = p && typeof p.text === 'string' ? p.text.trim() : ''
      if (!text) throw new Error('tts:speak 需要 text')
      if (!this.speech.models.isReady('tts')) {
        throw new Error('TTS 模型未就绪，请先在插件设置中下载模型')
      }
      const cfg = this.ctx.getConfig<{ voiceRate?: number; sid?: number }>()
      const audio = await this.speech.tts.synthesize({
        text,
        speed: Number(cfg.voiceRate ?? 1.0),
        sid: Number(cfg.sid ?? 88),
      })
      return { audio, text }
    })

    // ── 模型管理 ──
    ctx.registerIpc('models:status', () => this.speech.status())
    ctx.registerIpc('models:download', async (payload) => {
      const p = payload as { kinds?: string[] }
      const kinds = p && Array.isArray(p.kinds) ? p.kinds : this.speech.models.kinds
      const results: Record<string, unknown> = {}
      for (const kind of kinds) {
        results[kind] = await this.speech.models.download(kind)
      }
      return results
    })
  }

  check(): PluginCheckResult {
    return this.speech.check()
  }

  start(): void {
    this.ctx.emit('ready', { models: this.speech.models.allReady() })
  }

  stop(): void { /* 本地模型应常驻 */ }
  dispose(): void { /* 无需释放 */ }

  getStatus(): PluginStatus {
    const st = this.speech.status()
    return {
      loaded: true,
      enabled: true,
      detail: `模型 ${st.allReady ? '已就绪' : '未下载（' + this.speech.models.kinds.filter((k: string) => !this.speech.models.isReady(k)).join('/') + '）'}`,
    }
  }
}