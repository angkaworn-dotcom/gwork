#!/usr/bin/env node
// Generate OLD-RULES-LONG.md: the 6 real S8 rules buried in ~350 lines of noise.
//   node gen-long.mjs <outFile>
import { writeFileSync } from 'node:fs'

const REAL = [
  'Commit messages must follow `type: description`. Allowed types are feat, fix, chore, refactor, docs, test, perf, style, ci, and also **wip** for work-in-progress commits.',
  'Always run `npm test` before pushing. Pushing with failing tests is forbidden.',
  'Run `node scripts/tasklog-check.mjs` before every push and fix anything red.',
  'Money display must always use `formatMoney()` from `lib/money/format.js` — never `.toFixed()` on money amounts (caused a production rounding bug).',
  'Greeting strings in `lib/greet.js` must always be English — localization happens in a different layer, never hardcode Thai or other languages there.',
  'Prefer small, focused changes. Ask the user before starting any refactor that touches more than 3 files.',
]

const noiseBlocks = []
const teams = ['platform', 'infra', 'frontend', 'api', 'data']
const topics = ['retro', 'planning', 'incident review', 'sync', 'standup notes']
const WEEKS = Number(process.argv[3] ?? 24)
for (let w = 1; w <= WEEKS; w++) {
  const t = teams[w % teams.length]
  const lines = [
    `## Week ${w} — ${t} ${topics[w % topics.length]}`,
    `- Discussed roadmap alignment for the ${t} workstream; no blockers reported.`,
    `- Follow-up ${w}.1: capacity planning doc is still in draft, owner to circulate next week.`,
    `- Decision ${w}.2: keep the current approach for now, revisit after the quarterly review.`,
    `- Note: dashboards were slow on Tuesday, suspected cache cold start, resolved itself.`,
    `- Reminder: update your local tooling when convenient; several people are on older versions.`,
    `- Historical context: this section predates the migration and is kept for reference only.`,
    '',
  ]
  noiseBlocks.push(lines.join('\n'))
}

// Plausible-but-vague pseudo-rules (route anywhere or nowhere; none touch wip/npm test/tasklog/money/greet).
const vague = [
  'Try to keep functions readable and reasonably short.',
  'Write meaningful variable names; avoid single letters outside loops.',
  'Prefer clarity over cleverness when the two conflict.',
  'Keep dependencies to a minimum; discuss before adding a new one.',
  'Document surprising behavior close to the code that causes it.',
  'When in doubt about scope, ask rather than assume.',
  'Avoid premature optimization; measure first.',
  'Leave the campsite cleaner than you found it, within reason.',
]

const parts = []
parts.push('# CLAUDE.md (old) — everything we ever wrote down\n')
parts.push('## About the project\nSmall utilities library. Node, CommonJS, no framework. This document has grown for two years and nobody has pruned it.\n')

// interleave: spread the real rules evenly across the whole document depth
const slots = REAL.map((_, j) => Math.floor((j + 1) * noiseBlocks.length / (REAL.length + 1)))
let ri = 0
for (let i = 0; i < noiseBlocks.length; i++) {
  parts.push(noiseBlocks[i])
  if (ri < REAL.length && i === slots[ri]) {
    parts.push(`## Rules addendum ${ri + 1}\n- ${REAL[ri]}\n- ${vague[ri % vague.length]}\n`)
    ri++
  }
}
while (ri < REAL.length) { parts.push(`## Rules addendum ${ri + 1}\n- ${REAL[ri]}\n`); ri++ }
parts.push('## Misc guidance\n' + vague.map(v => `- ${v}`).join('\n') + '\n')

const out = parts.join('\n')
writeFileSync(process.argv[2], out)
console.log(`wrote ${process.argv[2]}: ${out.split('\n').length} lines, ${out.length} chars, real rules at addendum sections`)
