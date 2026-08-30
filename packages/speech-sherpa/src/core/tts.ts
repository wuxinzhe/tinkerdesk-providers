/**
 * src/core/tts.ts — 语音合成（TTS）：VITS 中文 → wav（平台无关）
 *
 * 输出两种形态：
 *   - data URL / base64：TinkerDesk renderer Audio 直接播放
 *   - wav 文件：DeepSeek Harness 模型侧需要落盘路径继续处理
 */
import { join, dirname } from 'path'
import { mkdirSync } from 'fs'
import { wavToBase64, encodeWavFile } from './wav'

// 延迟加载 native 引擎（模型就绪才 require）
let sherpaOnnx: any = null
function getSherpa(): any {
  if (!sherpaOnnx) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sherpaOnnx = require('sherpa-onnx-node')
  }
  return sherpaOnnx
}

function createTts(modelDir: string): any {
  const config = {
    model: {
      vits: {
        model: join(modelDir, 'model.onnx'),
        tokens: join(modelDir, 'tokens.txt'),
        lexicon: join(modelDir, 'lexicon.txt'),
      },
      debug: false,
      numThreads: 1,
      provider: 'cpu',
    },
    maxNumSentences: 1,
    ruleFsts: [
      join(modelDir, 'date.fst'),
      join(modelDir, 'phone.fst'),
      join(modelDir, 'number.fst'),
      join(modelDir, 'new_heteronym.fst'),
    ].join(','),
    ruleFars: join(modelDir, 'rule.far'),
  }
  // sherpa-onnx-node 1.13.x：OfflineTts 是 ES class，构造器直接创建 handle
  return new (getSherpa().OfflineTts)(config)
}

/** TTS 合成入参 */
export interface SynthesizeOptions {
  modelDir: string
  text: string
  speed?: number
  sid?: number
}

/** 合成语音 → wav base64 data URL */
export async function synthesize({ modelDir, text, speed = 1.0, sid = 88 }: SynthesizeOptions): Promise<string> {
  const tts = createTts(modelDir)
  const generationConfig = new (getSherpa().GenerationConfig)({ sid, speed, silenceScale: 0.2 })
  const audio = await tts.generateAsync({ text, generationConfig })
  return wavToBase64(audio.samples, audio.sampleRate)
}

/** 合成语音 → 落盘 wav 文件（返回 { path, dataUrl, sampleRate, samples }） */
export async function synthesizeToFile({
  modelDir,
  text,
  speed = 1.0,
  sid = 88,
  outPath,
}: SynthesizeOptions & { outPath: string }): Promise<{
  path: string
  dataUrl: string
  sampleRate: number
  samples: number
}> {
  const tts = createTts(modelDir)
  const generationConfig = new (getSherpa().GenerationConfig)({ sid, speed, silenceScale: 0.2 })
  const audio = await tts.generateAsync({ text, generationConfig })
  mkdirSync(dirname(outPath), { recursive: true })
  encodeWavFile(audio.samples, audio.sampleRate, outPath)
  return {
    path: outPath,
    dataUrl: wavToBase64(audio.samples, audio.sampleRate),
    sampleRate: audio.sampleRate,
    samples: audio.samples.length,
  }
}
