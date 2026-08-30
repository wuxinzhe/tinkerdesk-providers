/**
 * src/core/models.ts — 模型管理：状态检查 + 下载（GitHub Release 直链，断点续传）
 *
 * 目录约定（configDir 参数 = 模型根，内部不再拼 models/）：
 *   <root>/stt/   STT Zipformer 中文 int8（tar.bz2 需解压）
 *   <root>/tts/   VITS 中文 AISHELL3（tar.bz2 需解压）
 */
import { existsSync, mkdirSync, createWriteStream, readdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { pipeline } from 'stream/promises'
import { get as httpsGet } from 'https'
import type { IncomingMessage } from 'http'

/** 模型规格 */
export interface ModelSpec {
  archive?: string
  file?: string
  required: string[]
  url: string
  sizeMB: number
}

/** 模型清单（单一事实源；manifest.assetDeps 仅作展示） */
export const MODELS: Record<string, ModelSpec> = {
  stt: {
    archive: 'sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30.tar.bz2',
    required: ['encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt'],
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30.tar.bz2',
    sizeMB: 126,
  },
  tts: {
    archive: 'vits-icefall-zh-aishell3.tar.bz2',
    required: ['model.onnx', 'tokens.txt', 'lexicon.txt'],
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-zh-aishell3.tar.bz2',
    sizeMB: 30,
  },
}

/** 进度事件 */
export interface ModelProgressEvent {
  kind: string
  phase: 'download' | 'extract' | 'done'
  percent: number
  hint?: string
}

/** Windows 解压工具：优先 System32 自带 bsdtar（支持 bz2）；存在性探测避免 PATH 里 GNU tar 抢跑 */
function tarBin(): string {
  if (process.platform === 'win32') {
    const sysTar = (process.env.SystemRoot ? process.env.SystemRoot : 'C:\\Windows') + '\\System32\\tar.exe'
    return existsSync(sysTar) ? sysTar : 'tar'
  }
  return 'tar'
}

/** 模型是否就绪（解压后必需文件存在） */
export function isModelReady(configDir: string, kind: string): boolean {
  const spec = MODELS[kind]
  if (!spec) return false
  const dir = join(configDir, kind)
  if (!existsSync(dir)) return false
  if (spec.file) return existsSync(join(dir, spec.file))
  return spec.required.every((f) => existsSync(join(dir, f)))
}

/** 全部模型就绪 */
export function allReady(configDir: string): boolean {
  return Object.keys(MODELS).every((k) => isModelReady(configDir, k))
}

/** 下载并解压模型（emit 进度事件）；已就绪直接返回 */
export async function downloadModel(
  configDir: string,
  kind: string,
  _manifest?: unknown,
  emit: (evt: ModelProgressEvent) => void = () => {},
): Promise<{ ok: boolean; skipped?: boolean }> {
  const spec = MODELS[kind]
  if (!spec) throw new Error(`模型 ${kind} 未配置`)
  if (isModelReady(configDir, kind)) return { ok: true, skipped: true }

  const url = spec.url
  if (!url) throw new Error(`模型 ${kind} 未配置下载地址`)

  const targetDir = join(configDir, kind)
  mkdirSync(targetDir, { recursive: true })
  emit({ kind, phase: 'download', percent: 0 })

  // 下载（断点续传 -C - 语义：用 range 头）
  const tmpFile = join(targetDir, spec.archive ?? spec.file ?? "")
  // 多源回退：镜像1(ghfast) → 镜像2(gh-proxy) → 主源(GitHub)
  const mirrors: Array<(u: string) => string> = [
    (u) => `https://ghfast.top/${u}`,
    (u) => `https://gh-proxy.com/${u}`,
    (u) => u,
  ]
  let lastErr: Error | null = null
  for (let i = 0; i < mirrors.length; i++) {
    const tryUrl = mirrors[i](url)
    try {
      await downloadWithProgress(tryUrl, tmpFile, (percent) => {
        emit({ kind, phase: 'download', percent })
      })
      lastErr = null
      break
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      if (i < mirrors.length - 1) {
        emit({ kind, phase: 'download', percent: 1, hint: `源${i + 1}失败，切换镜像…` })
      }
    }
  }
  if (lastErr) throw lastErr

  if (spec.archive) {
    emit({ kind, phase: 'extract', percent: 100 })
    // Windows 10+ 自带 tar（支持 bz2）；解压后目录为包内顶层目录，把内容平铺到 targetDir
    execFileSync(tarBin(), ['-xjf', tmpFile, '-C', targetDir], { stdio: 'ignore' })
    // 平铺：解压出的子目录内容移到 targetDir 根
    for (const name of readdirSync(targetDir)) {
      const sub = join(targetDir, name)
      if (name.endsWith('.tar.bz2')) continue
      const st = statSync(sub)
      if (st.isDirectory()) {
        for (const inner of readdirSync(sub)) {
          renameSync(join(sub, inner), join(targetDir, inner))
        }
        rmSync(sub, { recursive: true, force: true })
      }
    }
    rmSync(tmpFile, { force: true })
  }

  if (!isModelReady(configDir, kind)) {
    throw new Error(`模型 ${kind} 解压后缺少必需文件（期望 ${spec.required.join(', ')}）`)
  }
  emit({ kind, phase: 'done', percent: 100 })
  return { ok: true }
}

/** 带进度的 HTTP 下载（Range 断点续传 + 重定向跟随） */
function downloadWithProgress(url: string, dest: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let downloaded = 0

    const request = (targetUrl: string, start: number): void => {
      const headers = start > 0 ? { Range: `bytes=${start}-` } : {}
      const req = httpsGet(targetUrl, { headers }, (res: IncomingMessage) => {
        const status = res.statusCode ?? 0
        if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
          res.resume()
          const next = res.headers.location
          if (!next) {
            reject(new Error(`重定向缺少 Location: ${targetUrl}`))
            return
          }
          request(new URL(next, targetUrl).toString(), start)
          return
        }
        if (status !== 200 && status !== 206) {
          reject(new Error(`下载失败 HTTP ${status}: ${targetUrl}`))
          return
        }
        const size = parseInt(res.headers['content-length'] ?? '0', 10) + (status === 206 ? start : 0)
        const ws = createWriteStream(dest, { flags: start > 0 ? 'a' : 'w' })
        ws.on('error', reject)
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (size > 0) onProgress(Math.min(99, Math.round((downloaded / size) * 100)))
        })
        pipeline(res, ws).then(resolve).catch(reject)
      })
      req.on('error', reject)
      // 30s 无进展 → 销毁连接，切下一个源（防卡死在慢源）
      req.setTimeout(30000, () => req.destroy(new Error(`下载超时（30s 无响应）: ${targetUrl}`)))
    }
    request(url, existsSync(dest) ? statSync(dest).size : 0)
  })
}
