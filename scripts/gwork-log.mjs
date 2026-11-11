#!/usr/bin/env node
/**
 * gwork-log.mjs — the mechanical half of closing out a task, done deterministically.
 * /gwork-log used to have the agent derive all of this by hand: the next anchor id, the files
 * and commits since the last entry, which modules they map to, and one INDEX edit per module.
 * Those are facts, not judgment — and each was a way to fail check A or B at push. This script
 * computes them; the agent writes only what needs a mind (context, decision, gotcha, validation).
 *
 * Usage (from the repo, run out of the kit):
 *   node <kit>/scripts/gwork-log.mjs [--title "…"] [--since <ref>]   → print the plan, change nothing
 *   node <kit>/scripts/gwork-log.mjs --write [--title "…"]           → append the entry skeleton,
 *                                                                       link it from every touched module's row
 * Since = the last commit that touched task-log/ unless --since is given.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { git, lines, rootOf, loadConfig, moduleMapper, splitRow, isDataRow } from './gwork-lib.mjs'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : undefined }
const root = rootOf(process.cwd())
if (!root) { console.error('gwork-log: no task-log/INDEX.md here or above — is gwork installed in this repo?'); process.exit(1) }
let cfg
try { cfg = loadConfig(root) } catch (e) { console.error(`gwork-log: cannot parse gwork.json — ${e.message}`); process.exit(1) }
const moduleOf = moduleMapper(cfg)

// --- what happened since the last entry ---
const sinceArg = opt('since')
if (sinceArg !== undefined && git(root, 'rev-parse', '--verify', '--quiet', `${sinceArg}^{commit}`) === null) { console.error(`gwork-log: --since "${sinceArg}" is not a commit in this repo`); process.exit(1) }
const since = sinceArg ?? git(root, 'log', '-1', '--format=%H', '--', 'task-log')?.trim() ?? ''
const range = since ? [`${since}..HEAD`] : ['HEAD']
const commits = lines(git(root, 'log', '--reverse', '--format=%h %s', ...range, '--', '.', ':!task-log'))
const changed = new Set([
  ...lines(since ? git(root, 'diff', '--name-only', since) : git(root, 'ls-files')), // base → working tree, so uncommitted work counts
  ...lines(git(root, 'ls-files', '--others', '--exclude-standard')),
])
const files = [...changed].filter(f => !f.startsWith('task-log/')).sort()
if (!files.length && !commits.length) { console.error('gwork-log: nothing changed since the last task-log entry — no entry to write'); process.exit(1) }
const modules = [...new Set(files.map(f => moduleOf(f) ?? 'misc'))]
if (!modules.length) modules.push('misc')

// --- the next anchor id: YYYY-MM-DD, then -2, -3 … within the day ---
const now = new Date()
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const shardRel = `task-log/${date.slice(0, 7)}.md`
const shardPath = join(root, shardRel)
const shard = existsSync(shardPath) ? readFileSync(shardPath, 'utf8') : ''
const today = [...shard.matchAll(/<a id="([^"]+)"><\/a>/g)].map(m => m[1]).filter(id => id === date || id.startsWith(date + '-'))
const seqs = today.map(id => id === date ? 1 : Number(id.slice(date.length + 1))).filter(Number.isFinite)
const id = today.length ? `${date}-${Math.max(1, ...seqs) + 1}` : date

// --- INDEX: follow the link style the file already uses ---
const indexPath = join(root, 'task-log', 'INDEX.md')
const indexLines = readFileSync(indexPath, 'utf8').split('\n')
const prefix = /\]\(task-log\//.test(indexLines.join('\n')) || !/\]\(\d{4}-\d{2}\.md#/.test(indexLines.join('\n')) ? 'task-log/' : ''
const link = `[${id}](${prefix}${date.slice(0, 7)}.md#${id})`
const plan = modules.map(mod => {
  const at = indexLines.findIndex(l => { const p = splitRow(l); return isDataRow(p) && p[1].trim() === mod })
  return { mod, at }
})

// the title becomes one markdown header line
const title = (opt('title') ?? 'TODO: short title').replace(/\s*[\r\n]+\s*/g, ' ').trim() || 'TODO: short title'
const entry = [
  `<a id="${id}"></a>`,
  `## ${date} — ${title}`,
  '',
  '- **Context:** TODO — the problem this solved, in one or two lines',
  `- **Files:** ${files.length ? files.slice(0, 40).join(', ') + (files.length > 40 ? ` (+${files.length - 40} more)` : '') : 'none'}`,
  `- **Commits:** ${commits.length ? commits.join(' · ') : 'none yet (uncommitted work)'}`,
  '- **Decision:** TODO — or "none"',
  '- **Gotcha:** TODO — or "none"',
  '- **Validation:** TODO — what was actually run, and its result',
  '- **Impact on prior work:** TODO — or "none"',
].join('\n')

if (!args.includes('--write')) {
  console.log(`gwork-log plan — nothing written (add --write)\n`)
  console.log(`entry ${id} → ${shardRel}\n`)
  console.log(entry + '\n')
  console.log('INDEX rows:')
  for (const { mod, at } of plan) console.log(`  ${at > -1 ? 'prepend link to' : 'NEW row for   '} ${mod}`)
  process.exit(0)
}

writeFileSync(shardPath, (shard.trim() ? shard.trimEnd() + '\n\n---\n\n' : '') + entry + '\n')
for (const { mod, at } of plan) {
  if (at > -1) {
    const p = splitRow(indexLines[at])
    const cur = p[2].trim()
    p[2] = ` ${link}${cur ? ' · ' + cur : ''} `
    indexLines[at] = p.join('|')
  } else {
    while (indexLines.length && indexLines[indexLines.length - 1] === '') indexLines.pop()
    indexLines.push(`| ${mod.replace(/(?<!\\)\|/g, '\\|')} | ${link} | — | — |`, '')
  }
}
writeFileSync(indexPath, indexLines.join('\n'))
console.log(`gwork-log: wrote entry ${id} to ${shardRel} and linked it from ${plan.length} INDEX row(s): ${modules.join(', ')}`)
console.log('Next: replace every TODO in the entry · put a real lesson in the Gotcha column of the row it belongs to (≤1 line) · node scripts/tasklog-check.mjs · commit shard + INDEX together')
