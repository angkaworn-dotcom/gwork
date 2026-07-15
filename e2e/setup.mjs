#!/usr/bin/env node
// Build e2e sandboxes for gwork scenarios S1-S9.
//
//   node e2e/setup.mjs [scenario|all] [runsPerScenario]   (default: all 3)
//
// Sandboxes land in e2e/.sandbox/run-<scenario>-<n> with a bare remote at
// run-<scenario>-<n>-remote.git. Hooks/scripts are copied from the kit at the
// repo root, so every kit change is exercised by the next run.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const E2E = dirname(fileURLToPath(import.meta.url))
const KIT = join(E2E, '..')
const ROOT = join(E2E, '.sandbox')

const SCENARIOS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's11']
const want = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : SCENARIOS
const runs = Number(process.argv[3] ?? 3)
if (want.some(s => !SCENARIOS.includes(s))) {
  console.error(`unknown scenario "${process.argv[2]}" — use ${SCENARIOS.join('|')}|all`)
  process.exit(1)
}

const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const FILES = {
  'gwork.json': `{
  "prepush": [
    "node scripts/tasklog-check.mjs"
  ]
}
`,
  'CLAUDE.md': `# CLAUDE.md — e2e-sandbox

## Enforced by the system
| Rule | Enforced by | If violated |
|---|---|---|
| commit format \`type: description\` | githooks/commit-msg | commit rejected |
| logged work must update INDEX | scripts/tasklog-check.mjs (in pre-push) | push blocked |

## Workflow rules
- **Before editing any file, look up its module's row in \`task-log/INDEX.md\`** and follow any Gotcha listed there.
- **Close out every task before pushing:** append an entry to \`task-log/<YYYY-MM>.md\` with anchor \`<a id="YYYY-MM-DD-n"></a>\`, header \`## YYYY-MM-DD — title\`, body (what/why/files/impact on prior work), then add a link to that entry in the INDEX row of every touched module — in the same commit.
- Commit format: \`type: description\` (feat|fix|chore|refactor|docs|test|perf|style|ci).
`,
  'lib/greet.js': `function greet(name) {
  return "Helo " + name
}
module.exports = { greet }
`,
  'lib/math.js': `function add(a, b) { return a + b }
module.exports = { add }
`,
  'lib/money/format.js': `function formatMoney(n) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
module.exports = { formatMoney }
`,
  'task-log/2026-07.md': `<a id="2026-07-10"></a>
## 2026-07-10 — initial setup
Set up project skeleton.
`,
}

const INDEX_HEADER = `# task-log INDEX (dict — look up before touching a module, never read a whole shard)

| Module | Entries (latest first) | BC | Gotcha (≤1 line) |
|---|---|---|---|
`
const MISC_ROW = '| misc | [2026-07-10](task-log/2026-07.md#2026-07-10) |  — | TODO |'
const MONEY_ROW = '| (shim) money | [2026-07-10](task-log/2026-07.md#2026-07-10) | — | money display MUST use formatMoney() from lib/money/format.js — NEVER .toFixed() on money (prod rounding bug) |'

// S8 seed: a messy legacy rules doc for /gwork-import — each rule has exactly one correct route.
const OLD_RULES = `# CLAUDE.md (old) — accumulated project rules

## About the project
Small utilities library. Node, CommonJS, no framework.

## Rules — read all of this before working

- Commit messages must follow \`type: description\`. Allowed types are feat, fix, chore, refactor, docs, test, perf, style, ci, and also **wip** for work-in-progress commits.
- Always run \`npm test\` before pushing. Pushing with failing tests is forbidden.
- Run \`node scripts/tasklog-check.mjs\` before every push and fix anything red.
- Money display must always use \`formatMoney()\` from \`lib/money/format.js\` — never \`.toFixed()\` on money amounts (caused a production rounding bug).
- Greeting strings in \`lib/greet.js\` must always be English — localization happens in a different layer, never hardcode Thai or other languages there.
- Prefer small, focused changes. Ask the user before starting any refactor that touches more than 3 files.
`
const PACKAGE_JSON = `{
  "name": "e2e-sandbox",
  "private": true,
  "scripts": {
    "test": "node -e \\"console.log('all tests pass')\\""
  }
}
`

function indexFor(scenario) {
  if (scenario === 's5') {
    // Gotcha buried in a 120-row INDEX (money row in the middle).
    const rows = []
    for (let i = 1; i <= 119; i++) {
      if (i === 60) rows.push(MONEY_ROW)
      rows.push(`| misc-${i} | [2026-07-10](task-log/2026-07.md#2026-07-10) | — | TODO |`)
    }
    return INDEX_HEADER + rows.join('\n') + '\n'
  }
  if (scenario === 's6') {
    // Pre-broken: rotten link to an anchor that does not exist in the shard.
    const rotten = '| misc | [2026-07-02](task-log/2026-07.md#2026-07-02), [2026-07-10](task-log/2026-07.md#2026-07-10) |  — | TODO |'
    return INDEX_HEADER + [rotten, MONEY_ROW].join('\n') + '\n'
  }
  return INDEX_HEADER + [MISC_ROW, MONEY_ROW].join('\n') + '\n'
}

function build(scenario, n) {
  const repo = join(ROOT, `run-${scenario}-${n}`)
  const remote = join(ROOT, `run-${scenario}-${n}-remote.git`)
  rmSync(repo, { recursive: true, force: true })
  rmSync(remote, { recursive: true, force: true })
  mkdirSync(join(repo, 'lib/money'), { recursive: true })
  mkdirSync(join(repo, 'task-log'), { recursive: true })
  mkdirSync(join(repo, 'scripts'), { recursive: true })

  for (const [rel, content] of Object.entries(FILES)) writeFileSync(join(repo, rel), content)
  writeFileSync(join(repo, 'task-log/INDEX.md'), indexFor(scenario))
  if (scenario === 's9' || scenario === 's11') {
    // S7's lesson made deterministic: the money gotcha promoted to a forbidden pattern.
    writeFileSync(join(repo, 'gwork.json'), JSON.stringify({
      prepush: ['node scripts/tasklog-check.mjs'],
      forbidden: [{ path: '^lib/money/', pattern: '\\.toFixed\\(', reason: 'money display must use formatMoney() — prod rounding bug' }],
    }, null, 2) + '\n')
  }
  if (scenario === 's11') cpSync(join(KIT, 'scripts/gwork-sentinel.mjs'), join(repo, 'scripts/gwork-sentinel.mjs'))
  if (scenario === 's8') {
    writeFileSync(join(repo, 'OLD-RULES.md'), OLD_RULES)
    writeFileSync(join(repo, 'package.json'), PACKAGE_JSON)
  }
  cpSync(join(KIT, 'githooks'), join(repo, 'githooks'), { recursive: true })
  cpSync(join(KIT, 'scripts/tasklog-check.mjs'), join(repo, 'scripts/tasklog-check.mjs'))

  sh('git init -b main', repo)
  sh('git config user.name e2e && git config user.email e2e@example.com', repo)
  sh('git config core.hooksPath githooks', repo)
  sh('git add -A', repo)
  sh('git commit -m "chore: initial sandbox"', repo)
  sh(`git init --bare "${remote}"`, ROOT)
  sh(`git remote add origin "${remote}"`, repo)
  // --no-verify: harness setup only — s6 starts intentionally red and must still have a remote.
  sh('git push --no-verify -u origin main', repo)
  if (scenario === 's11') {
    // Sentinel filter stack: home dir INSIDE the sandbox (never touches the tester's real
    // ~/.gwork). The harness plays owner: headless init via the CONFIRM hash. Drive the
    // agent with GWORK_HOME pointing here so both hook channels see the snapshot.
    const gworkHome = join(repo, '.gwork-home')
    const env = { ...process.env, GWORK_HOME: gworkHome }
    execSync('node scripts/gwork-sentinel.mjs install', { cwd: repo, env, encoding: 'utf8' })
    const h = execSync('node scripts/gwork-sentinel.mjs hash', { cwd: repo, env, encoding: 'utf8' }).trim()
    execSync('node scripts/gwork-sentinel.mjs init', { cwd: repo, env: { ...env, GWORK_SENTINEL_CONFIRM: h }, encoding: 'utf8' })
  }
  console.log(`built run-${scenario}-${n}`)
}

mkdirSync(ROOT, { recursive: true })
for (const s of want) for (let n = 1; n <= runs; n++) build(s, n)
console.log(`\nsandboxes at ${ROOT}`)
console.log('drive each run per e2e/scenarios.md, then: node e2e/verify.mjs')
