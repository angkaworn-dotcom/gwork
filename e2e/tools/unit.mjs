#!/usr/bin/env node
// Deterministic unit tests for the enforcement machinery — no LLM, no network.
// Covers: sentinel (machinery tamper / guards drift / confirm flow / journal / pre-push
// block) and edit-time forbidden-content enforcement in both agent hooks.
//   node e2e/tools/unit.mjs        (builds its own s11 sandbox under e2e/.sandbox)
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const E2E = join(dirname(fileURLToPath(import.meta.url)), '..')
const KIT = join(E2E, '..')
const SB = join(E2E, '.sandbox')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { console.log(`PASS ${name}`); pass++ } else { console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); fail++ } }
const run = (cmd, cwd, env) => spawnSync(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, encoding: 'utf8' })
const sh = (cmd, cwd) => { try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch { return null } }

// fresh sandbox with sentinel installed + snapshotted (setup.mjs plays owner)
execSync(`node "${join(E2E, 'setup.mjs')}" s11 1`, { cwd: KIT, stdio: 'ignore' })
const R = join(SB, 'run-s11-1')
const HOME = join(R, '.gwork-home')
const env = { GWORK_HOME: HOME }
const sentinel = (...a) => run(['node', 'scripts/gwork-sentinel.mjs', ...a], R, env)
const SENT_BIN = join(HOME, 'bin', 'gwork-sentinel.mjs')

// --- sentinel: clean state verifies OK ---
ok('sentinel-clean-ok', sentinel('verify').status === 0)

// --- sentinel: core.hooksPath removal = machinery tamper (exit 2) ---
sh('git config --unset core.hooksPath', R)
ok('sentinel-hookspath-tamper', sentinel('verify').status === 2)
sh('git config core.hooksPath githooks', R)
ok('sentinel-hookspath-restored', sentinel('verify').status === 0)

// --- sentinel: neutered checker = machinery tamper (exit 2) ---
const checker = join(R, 'scripts/tasklog-check.mjs')
const checkerSrc = readFileSync(checker, 'utf8')
writeFileSync(checker, 'process.exit(0)\n')
ok('sentinel-checker-neutered', sentinel('verify').status === 2)
writeFileSync(checker, checkerSrc)
ok('sentinel-checker-restored', sentinel('verify').status === 0)

// --- sentinel: emptying forbidden[] = guards drift (exit 3), machinery still clean ---
const cfgPath = join(R, 'gwork.json')
const cfgSrc = readFileSync(cfgPath, 'utf8')
const cfg = JSON.parse(cfgSrc); cfg.forbidden = []
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
ok('sentinel-guards-drift', sentinel('verify').status === 3)
writeFileSync(cfgPath, cfgSrc)
ok('sentinel-guards-restored', sentinel('verify').status === 0)

// --- sentinel: non-interactive update refused without CONFIRM, accepted with it ---
sh('git config --unset core.hooksPath', R)
ok('sentinel-update-refused', sentinel('update').status === 1)
const h = sentinel('hash').stdout.trim()
ok('sentinel-update-confirmed', run(['node', 'scripts/gwork-sentinel.mjs', 'update'], R, { ...env, GWORK_SENTINEL_CONFIRM: h }).status === 0)
ok('sentinel-verify-after-update', sentinel('verify').status === 0)
ok('sentinel-journal-chained', (sentinel('journal').stdout.match(/"action"/g) || []).length >= 2)
sh('git config core.hooksPath githooks', R) // restore for later git ops (snapshot now expects MISSING — fine, isolated below)

// --- pre-push blocks a machinery tamper via a real git push (fresh sandbox to avoid snapshot carryover) ---
execSync(`node "${join(E2E, 'setup.mjs')}" s11 2`, { cwd: KIT, stdio: 'ignore' })
const R2 = join(SB, 'run-s11-2'), HOME2 = join(R2, '.gwork-home')
writeFileSync(join(R2, 'scripts/tasklog-check.mjs'), 'process.exit(0)\n')
sh('git add scripts/tasklog-check.mjs && git commit -q -m "chore: x"', R2)
const push = run(['git', 'push', 'origin', 'main'], R2, { GWORK_HOME: HOME2 })
ok('sentinel-prepush-blocks', push.status !== 0 && /sentinel/.test(push.stdout + push.stderr))

// --- edit-time forbidden content: both hooks, using Windows-style repo paths ---
const winR = R.replace(/\\/g, '/')
const feed = (hookRel, payload) => spawnSync('node', [join(KIT, hookRel)], { input: JSON.stringify(payload), encoding: 'utf8' }).stdout
const CL = 'hooks/tasklog-gotcha.mjs', HE = 'hermes/hooks/tasklog-gotcha-hermes.mjs'

let o = feed(CL, { tool_input: { file_path: `${winR}/lib/money/display.js`, content: 'const d=n=>n.toFixed(2)' }, cwd: winR, session_id: 'u1' })
ok('edit-claude-forbidden-denies', /"permissionDecision":"deny"/.test(o) && /forbidden/i.test(o), o.slice(0, 80))

o = feed(CL, { tool_input: { file_path: `${winR}/lib/util.js`, content: 'const d=n=>n.toFixed(2)' }, cwd: winR, session_id: 'u2' })
ok('edit-claude-otherpath-allowed', !/"permissionDecision":"deny"/.test(o))

o = feed(HE, { tool_name: 'write_file', tool_input: { path: `${winR}/lib/money/display.js`, content: 'const d=n=>n.toFixed(2)' }, cwd: winR, session_id: 'u3' })
ok('edit-hermes-forbidden-blocks', /"action":"block"/.test(o) && /forbidden/i.test(o), o.slice(0, 80))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
