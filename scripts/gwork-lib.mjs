/**
 * gwork-lib.mjs — helpers shared by the kit-side tools (gwork-log, gwork-stats, gwork-install,
 * gwork-drift run from the kit and are never copied into a target repo, so they may import).
 * The hooks and tasklog-check/migrate stay single-file on purpose: each is copied on its own.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

export const DEFAULT_MODULES = [
  { pattern: '^modules/([\\w-]+)/', name: '$1' },
  { pattern: '^(?:lib|app/actions)/([\\w-]+)', name: '(shim) $1' },
  { pattern: '^app/(?:visit/)?([\\w-]+)/', name: 'page:$1' },
  { pattern: '^components/([\\w-]+)/', name: 'ui:$1' },
  { pattern: '^tests/([\\w-]+)/', name: 'test:$1' },
  { pattern: '^(prisma|hooks|scripts)/', name: '$1' },
]
export const git = (cwd, ...args) => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null }
}
export const lines = (s) => (s ?? '').split(/\r?\n/).filter(Boolean)
export const rootOf = (start) => {
  for (let dir = start; ; ) {
    if (existsSync(join(dir, 'task-log', 'INDEX.md'))) return dir
    const up = dirname(dir); if (up === dir) return null; dir = up
  }
}
// unparseable config is an error here (these tools are run on purpose, not on every edit)
export const loadConfig = (root) => {
  const p = join(root, 'gwork.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}
export const moduleMapper = (cfg) => {
  const rules = Array.isArray(cfg.modules) && cfg.modules.length ? cfg.modules : DEFAULT_MODULES
  return (p) => {
    for (const r of rules) {
      let m
      try { m = p.match(new RegExp(r.pattern)) } catch { continue }
      if (m) return String(r.name).replace(/\$(\d)/g, (_, i) => m[+i] ?? '')
    }
    return null
  }
}
// INDEX rows: split on unescaped pipes, keeping the raw parts so a row can be rewritten in place
export const splitRow = (line) => line.split(/(?<!\\)\|/)
export const isDataRow = (parts) => parts.length >= 5 && parts[1].trim() !== 'Module' && !/^-+$/.test(parts[1].trim())
