/**
 * eslint.config.js — 根仓库统一 ESLint flat config（v9+）
 * 覆盖所有 packages/* 共享规则。各包可继承 root config 用 extends 字段（如需定制）。
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  // 全局忽略
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.tgz',
    ],
  },
  // 基础 JS 推荐
  js.configs.recommended,
  // TypeScript 规则（推荐集）
  ...tseslint.configs.recommended,
  // 各包应用
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js 全局（provider 扩展跑在 main 进程 / worker 进程）
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      // TS 推荐集中不适合 plugin 场景的关闭
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'off', // plugin 强类型不严格
      '@typescript-eslint/no-unused-expressions': 'off', // 业务常用 ! 非空断言
      // plugin SDK 导出兼容性：require/module 可用（speech-sherpa 用 require 加载 native binding）
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off', // TS 已处理类型检查
    },
  },
  // verify.js / pack.js 等脚本（CommonJS，Node 上下文）
  {
    files: ['packages/*/scripts/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
]
