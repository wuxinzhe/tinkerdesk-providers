/**
 * index.ts — 语音识别（Whisper）插件入口（TinkerDesk v2 OO 契约）
 *
 * 契约：export default class（loader 负责 new + init）
 * 能力：
 *   stt:transcribe {samples, sampleRate} → {text}   整段音频转文本
 *   models:status → 模型就绪状态
 *
 * 引擎：whisper.cpp（whisper-cli.exe——Windows prebuilt——configDir/bin/）
 * 模型：ggml-small/medium.bin（多语言——configDir/models/——assetDeps 下载）
 */
import { existsSync } from 'fs'
import { join } from 'path'
import type { PluginCheckResult, PluginContext, PluginStatus, TinkerProvider } from '../plugin-types'
import { createStt } from './stt'
import { modelStatus, isModelReady } from './models'

export default class WhisperSttProvider implements TinkerProvider {
  private ctx!: PluginContext
  private stt: ReturnType<typeof createStt> | null = null

  init(ctx: PluginContext): void {
    this.ctx = ctx
    this.stt = createStt(ctx)

    // ── STT：应用录音完成后调此接口转文本 ──
    ctx.registerIpc('stt:transcribe', (payload) => {
      const p = payload as { samples?: Float32Array; sampleRate?: number } | null | undefined
      const samples = p?.samples
      const sampleRate = p?.sampleRate ?? 16000
      if (!samples || samples.length === 0) {
        throw new Error('stt:transcribe 需要 samples（Float32Array 16kHz）')
      }
      return this.stt!.transcribe(samples, sampleRate)
    })

    // ── 模型状态（设置页展示/下载引导） ──
    ctx.registerIpc('models:status', () => modelStatus(this.ctx))
  }

  check(): PluginCheckResult {
    const engineOk = this.existsEngine()
    const size = this.currentModelSize()
    const modelOk = isModelReady(this.ctx, size)
    const checks = [
      { name: 'whisper-cli 引擎', ok: engineOk, hint: engineOk ? undefined : '未下载（约 8MB——可下载）' },
      { name: `模型（${size}）`, ok: modelOk, hint: modelOk ? undefined : '未下载（可下载）' },
    ]
    return { ok: engineOk && modelOk, checks }
  }

  start(): void { /* 无常驻资源——推理按需起子进程 */ }
  stop(): void { /* 无常驻资源 */ }
  dispose(): void { /* 无需释放 */ }

  getStatus(): PluginStatus {
    const st = modelStatus(this.ctx)
    return {
      loaded: true,
      enabled: true,
      detail: st.allReady ? '就绪' : `未就绪（${st.missing.join('、')}）`,
    }
  }

  /** 当前配置的模型大小 */
  private currentModelSize(): string {
    const cfg = this.ctx.getConfig<{ modelSize?: string }>()
    return cfg.modelSize ?? 'small'
  }

  private existsEngine(): boolean {
    return existsSync(join(this.ctx.configDir, 'bin', 'whisper-cli.exe'))
  }
}
