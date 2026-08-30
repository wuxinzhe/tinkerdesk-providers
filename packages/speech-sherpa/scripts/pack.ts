/**
 * scripts/pack.ts — 生成分发 zip（含 node_modules，用户解压即用）
 *
 * 产物：dist/tinkerdesk-provider-speech-sherpa.zip
 * 包内顶层目录：speech-sherpa/
 */
import { execFileSync } from 'child_process'
import { mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

/** scripts/ 目录 → 包根 */
const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const root = join(scriptsDir, '..')
const dist = join(root, 'dist')
const staging = join(dist, 'speech-sherpa')

// 1. 校验依赖已安装
const nm = join(root, 'node_modules')
if (!existsSync(nm) || !existsSync(join(nm, 'sherpa-onnx-node'))) {
  console.error('❌ 先执行 npm install（sherpa-onnx-node 未安装）')
  process.exit(1)
}

// 2. 清理并准备暂存目录
rmSync(dist, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

// 3. 拷贝插件文件 + node_modules（排除 dev 脚本/源码 map）
for (const name of ['manifest.json', 'README.md', 'LICENSE', 'package.json']) {
  execFileSync('cp', ['-r', join(root, name), join(staging, name)])
}
// tsc 产物（src → dist/index.js + core/）
execFileSync('cp', ['-r', join(dist, 'index.js'), join(staging, 'index.js')])
execFileSync('cp', ['-r', join(dist, 'core'), join(staging, 'core')])
execFileSync('cp', ['-r', join(nm), join(staging, 'node_modules')])

// 4. 压缩（Windows 10+ 自带 tar 支持 zip；用 System32 绝对路径避免 PATH 里 GNU tar 抢跑）
const zipPath = join(dist, 'tinkerdesk-provider-speech-sherpa.zip')
rmSync(zipPath, { force: true })
const sysTar = (process.env.SystemRoot ? process.env.SystemRoot : 'C:\\Windows') + '\\System32\\tar.exe'
const tarBin = existsSync(sysTar) ? sysTar : 'tar'
execFileSync(tarBin, ['-a', '-cf', zipPath, '-C', dist, 'speech-sherpa'])
rmSync(staging, { recursive: true, force: true })

console.log(`✅ 打包完成: ${zipPath}`)
