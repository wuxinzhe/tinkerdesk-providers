/**
 * scripts/verify.ts — 插件加载校验：模拟 TinkerDesk PluginManager 加载本插件
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const root = join(scriptsDir, '..')
const dist = join(root, 'dist')
const sherpa = join(root, 'node_modules', 'sherpa-onnx-node')
if (!existsSync(sherpa)) {
  console.error('❌ 未安装依赖：先执行 npm install')
  process.exit(1)
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const manifest = require(join(root, 'manifest.json')) as {
  id: string
  name: string
  version: string
  capabilities: string[]
  entry: string
  configSchema?: { properties?: Record<string, unknown> }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const entry = require(join(dist, manifest.entry))

interface PluginApi {
  getStatus: () => unknown
  dispose?: () => void
}

// 模拟 PluginContext
let ipcCount = 0
const ctx = {
  pluginId: manifest.id,
  configDir: root,
  getManifest: () => manifest,
  emit: (event: string, data?: unknown) => console.log(`  [event] ${event}`, data ?? ''),
  registerIpc: () => {
    ipcCount++
  },
  getConfig: () => ({}),
  setConfig: () => {},
}

const provider = entry.default
if (!provider) {
  console.error('❌ 插件入口没有 default export')
  process.exit(1)
}
const api = provider.init(ctx) as PluginApi
const schema = manifest.configSchema
const fields = schema && schema.properties ? Object.keys(schema.properties) : []
const status = api.getStatus()

console.log(`✅ 插件入口加载成功: ${manifest.name} v${manifest.version}`)
console.log(`   能力: ${manifest.capabilities.join(', ')}`)
console.log(`   配置项: ${fields.join(', ')}`)
console.log(`   注册 IPC: ${ipcCount} 个`)
console.log(`   状态: ${JSON.stringify(status)}`)
console.log(`   模型: ${JSON.stringify(api.getStatus())}`)

if (api.dispose) api.dispose()
console.log('✅ verify 通过')
