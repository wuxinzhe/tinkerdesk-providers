/**
 * src/core/index.ts — 平台无关语音核心门面（STT + TTS + 模型管理）
 *
 * 模型目录约定：
 *   - TinkerDesk：<configDir>/models/<kind>（configDir = 插件目录，应用托管）
 *   - DeepSeek Harness：<modelDir>/<kind>
 * 门面统一接收 { configDir } 或 { modelDir }，内部拼出 kind 子目录。
 */
import { join } from 'path'
import * as models from './models'
import { transcribe, transcribeFile, transcribeBase64 } from './stt'
import { synthesize, synthesizeToFile } from './tts'
import * as wav from './wav'

/** 音色/语速的默认值与选项 */
export const DEFAULTS = {
  voiceRate: 1.0,
  sid: 88,
  sidOptions: [
    { label: '女声 88', value: 88 },
    { label: '女声 90', value: 90 },
    { label: '男声 92', value: 92 },
    { label: '男声 94', value: 94 },
  ],
}

/** 门面入参 */
export interface SpeechServiceOptions {
  configDir?: string
  modelDir?: string
  manifest?: unknown
  emit?: (evt: unknown) => void
}

/** 创建语音服务实例 */
export function createSpeechService({ configDir, modelDir, manifest, emit = () => {} }: SpeechServiceOptions = {}) {
  const root = modelDir || join(configDir ?? '', 'models')
  const kindDir = (kind: string): string => join(root, kind)

  return {
    /** STT：三种输入形态 */
    stt: {
      transcribe: (samples: Float32Array): string =>
        transcribe({ modelDir: kindDir('stt'), samples }),
      transcribeFile: (audioPath: string): string =>
        transcribeFile({ modelDir: kindDir('stt'), audioPath }),
      transcribeBase64: (audioBase64: string): string =>
        transcribeBase64({ modelDir: kindDir('stt'), audioBase64 }),
    },

    /** TTS：两种输出形态 */
    tts: {
      synthesize: (opts: { text: string; speed?: number; sid?: number }): Promise<string> =>
        synthesize({ modelDir: kindDir('tts'), text: opts.text, speed: opts.speed ?? DEFAULTS.voiceRate, sid: opts.sid ?? DEFAULTS.sid }),
      synthesizeToFile: (opts: { text: string; speed?: number; sid?: number; outPath: string }): Promise<{
        path: string
        dataUrl: string
        sampleRate: number
        samples: number
      }> =>
        synthesizeToFile({
          modelDir: kindDir('tts'),
          text: opts.text,
          speed: opts.speed ?? DEFAULTS.voiceRate,
          sid: opts.sid ?? DEFAULTS.sid,
          outPath: opts.outPath,
        }),
    },

    /** 模型管理 */
    models: {
      isReady: (kind: string): boolean => models.isModelReady(root, kind),
      allReady: (): boolean => models.allReady(root),
      download: (kind: string): Promise<{ ok: boolean; skipped?: boolean }> =>
        models.downloadModel(root, kind, manifest, emit),
      downloadAll: async (): Promise<Record<string, { ok: boolean; skipped?: boolean }>> => {
        const results: Record<string, { ok: boolean; skipped?: boolean }> = {}
        for (const kind of Object.keys(models.MODELS)) {
          results[kind] = await models.downloadModel(root, kind, manifest, emit)
        }
        return results
      },
      kinds: Object.keys(models.MODELS),
    },

    /** 状态快照 */
    status(): { stt: boolean; tts: boolean; allReady: boolean } {
      return {
        stt: models.isModelReady(root, 'stt'),
        tts: models.isModelReady(root, 'tts'),
        allReady: models.allReady(root),
      }
    },

    /** 启用前自检 */
    check(): { ok: boolean; checks: Array<{ name: string; ok: boolean; hint?: string; action?: string }> } {
      const sttOk = models.isModelReady(root, 'stt')
      const ttsOk = models.isModelReady(root, 'tts')
      const checks = [
        {
          name: 'STT 模型',
          ok: sttOk,
          hint: sttOk ? undefined : '语音输入模型未下载（约 126MB）',
          action: sttOk ? undefined : 'download-models',
        },
        {
          name: 'TTS 模型',
          ok: ttsOk,
          hint: ttsOk ? undefined : '朗读模型未下载（约 30MB）',
          action: ttsOk ? undefined : 'download-models',
        },
      ]
      return { ok: sttOk && ttsOk, checks }
    },

    /** 配置常量（供适配层 schema 复用） */
    defaults: DEFAULTS,
  }
}

export { models, wav }
export type { ModelSpec, ModelProgressEvent } from './models'
