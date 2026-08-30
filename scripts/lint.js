/**
 * scripts/lint.js — root repo unified lint entry.
 *
 * Usage: npm run lint / npm run lint:fix
 * Walks packages/[name]/src explicitly to avoid shell-glob portability.
 */
import { ESLint } from 'eslint'
import { readdir } from 'node:fs/promises'

async function main() {
  const entries = await readdir('packages', { withFileTypes: true })
  const packages = entries
    .filter((e) => e.isDirectory())
    .map((e) => `packages/${e.name}/src`)
  const fix = process.argv.includes('--fix')
  const eslint = new ESLint({ fix, errorOnUnmatchedPattern: false })
  const results = await eslint.lintFiles(packages)
  const formatter = await eslint.loadFormatter('stylish')
  console.log(formatter.format(results))
  const errors = results.reduce((n, r) => n + r.errorCount, 0)
  const warnings = results.reduce((n, r) => n + r.warningCount, 0)
  const total = results.reduce((n, r) => n + r.messages.length, 0)
  console.log(`\n[lint] ${total} problems (${errors} errors, ${warnings} warnings)`)
  process.exit(errors > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
