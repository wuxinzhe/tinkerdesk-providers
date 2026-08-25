/**
 * plugin-types.d.ts — TinkerDesk 插件契约类型（应用侧 PluginContext/PluginApi 声明）
 *
 * 与主应用 src/main/core/plugin/types.ts 对应（起步自带——后续应用发
 * @tinkerdesk/plugin-types 类型包——单一来源）。
 */

/** 插件清单（manifest.json——应用侧静态声明） */
export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  entry: string
  capabilities?: string[]
  systemInterfaces?: { id: string }[]
  configSchema?: ConfigSchema
  assetDeps?: AssetDep[]
  modelDeps?: AssetDep[]
}

export interface AssetDep {
  name: string
  dest: string
  sizeMB: number
  url: string
  optional?: boolean
}

/** 配置 schema（JSON 方言——静态声明） */
export interface ConfigSchema {
  type: 'object'
  properties: Record<string, ConfigField>
}

export type ConfigField = {
  type: 'string' | 'number' | 'boolean' | 'select' | 'secret' | 'textarea' | 'file'
  title: string
  description?: string
  default?: unknown
  placeholder?: string
  min?: number
  max?: number
  step?: number
  options?: { label: string; value: string | number }[]
  filters?: { name: string; extensions: string[] }[]
}

/** 插件上下文（init 收到的 ctx） */
export interface PluginContext {
  pluginId: string
  configDir: string
  getManifest: () => PluginManifest
  /** 发事件到应用（renderer 监听 plugin:event） */
  emit: (event: string, data?: unknown) => void
  /** 注册 IPC 能力（renderer/agent 可调用） */
  registerIpc: (channel: string, handler: (payload: unknown) => unknown) => void
  getConfig: <T>() => T
  setConfig: (patch: Record<string, unknown>) => void
}

/** 插件状态（getStatus 返回——loaded/enabled 由应用托管，detail 扩展自定义） */
export interface PluginStatus {
  loaded?: boolean
  enabled?: boolean
  started?: boolean
  detail?: string
}

/** 自检项 */
export interface PluginCheckItem {
  name: string
  ok: boolean
  hint?: string
  /** 引导动作（UI 据此提供"去下载/去配置"按钮） */
  action?: 'download-models' | 'open-config'
}

/** 自检结果 */
export interface PluginCheckResult {
  ok: boolean
  checks: PluginCheckItem[]
}

/**
 * TinkerProvider v2 — Provider 统一契约（OO 形态）
 *
 * 一个类 = 一个扩展的完整生命体。入口导出类本身（loader 负责 new + init）。
 * 静态/动态分离：manifest.json（含 configSchema）先于代码加载——
 * 插件代码损坏不影响静态信息展示。
 */
export interface TinkerProvider {
  /** 声明式配置 schema（外置扩展以 manifest.json 为准——此字段仅作补充） */
  readonly configSchema?: ConfigSchema

  /** 构造性初始化：注册 IPC 能力频道、读取初始配置（每实例仅一次） */
  init(ctx: PluginContext): void | Promise<void>

  /** 自检（启用前必须通过；失败时 checks 给出修复引导） */
  check(): PluginCheckResult

  /** 启动（check 通过后调用） */
  start(): void | Promise<void>

  /** 停止（保持已加载状态，释放活动资源） */
  stop(): void | Promise<void>

  /** 彻底释放（卸载/热重载前） */
  dispose(): void | Promise<void>
}

/** @deprecated v1 旧形态（init 返回值）——升级到 TinkerProvider 类形态 */
export interface PluginApi {
  check(): PluginCheckResult
  start?(): void | Promise<void>
  stop?(): void | Promise<void>
  dispose?(): void | Promise<void>
  getStatus?(): Record<string, unknown>
}
