/**
 * src/core/stt.ts — 语音识别（STT）：纯识别能力（平台无关，不负责录音）
 *
 * 输入三种形态：
 *   - samples: Float32Array（16kHz 单声道 PCM，TinkerDesk 应用录音后传入）
 *   - audioPath: wav 文件路径（DeepSeek Harness 模型侧传文件）
 *   - audioBase64: data URL（DeepSeek Harness 模型侧传内嵌音频）
 * 输出：识别文本
 */
import { join } from 'path'
import { decodeWavFile, decodeWavBase64 } from './wav'

// 延迟加载 native 引擎（模型就绪才 require——Worker 启动不碰 native）
let sherpaOnnx: any = null
function getSherpa(): any {
  if (!sherpaOnnx) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sherpaOnnx = require('sherpa-onnx-node')
  }
  return sherpaOnnx
}

function createRecognizer(modelDir: string): any {
  const config = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, 'encoder.int8.onnx'),
        decoder: join(modelDir, 'decoder.onnx'),
        joiner: join(modelDir, 'joiner.int8.onnx'),
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  }
  return new (getSherpa().OnlineRecognizer)(config)
}

/** STT 转写入参 */
export interface TranscribeOptions {
  modelDir: string
  samples: Float32Array
}

/** 一次性整段转写（按住说话 → 松开 → 应用把音频送来） */
export function transcribe({ modelDir, samples }: TranscribeOptions): string {
  if (!samples || samples.length === 0) return ''
  const recognizer = createRecognizer(modelDir)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: 16000, samples })
  // 尾部补 0.4s 静音，让流式解码器 flush 出最后的内容
  stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(6400) })
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream)
  }
  const result = recognizer.getResult(stream)
  return (result && result.text ? String(result.text) : '').trim()
}

/** 从 wav 文件转写 */
export function transcribeFile({ modelDir, audioPath }: { modelDir: string; audioPath: string }): string {
  return transcribe({ modelDir, samples: decodeWavFile(audioPath) })
}

/** 从 data URL 转写 */
export function transcribeBase64({ modelDir, audioBase64 }: { modelDir: string; audioBase64: string }): string {
  return transcribe({ modelDir, samples: decodeWavBase64(audioBase64) })
}
