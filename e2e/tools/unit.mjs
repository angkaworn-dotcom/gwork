#!/usr/bin/env node
// Deterministic unit tests for the enforcement machinery — no LLM, no network.
// Covers: sentinel (machinery tamper / guards drift / confirm flow / journal / pre-push
// block) and edit-time forbidden-content enforcement in both agent hooks.
//   node e2e/tools/unit.mjs        (builds its own s11 sandbox under e2e/.sandbox)
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs'
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
const owner = { ...env, CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '' } // simulate the owner's own terminal
ok('sentinel-update-refused', run(['node', 'scripts/gwork-sentinel.mjs', 'update'], R, owner).status === 1)
const h = sentinel('hash').stdout.trim()

// --- sentinel: an AGENT shell is refused even with the correct hash — attestation is the owner's ---
const agentTry = run(['node', 'scripts/gwork-sentinel.mjs', 'update'], R, { ...env, CLAUDECODE: '1', GWORK_SENTINEL_CONFIRM: h })
ok('sentinel-agent-refused-despite-hash', agentTry.status === 1 && /agent shell/.test(agentTry.stderr))
ok('sentinel-agent-prints-owner-oneliner', new RegExp(h).test(agentTry.stderr))
ok('sentinel-agent-refusal-journaled', /"action":"refused"/.test(sentinel('journal').stdout))

ok('sentinel-update-confirmed', run(['node', 'scripts/gwork-sentinel.mjs', 'update'], R, { ...owner, GWORK_SENTINEL_CONFIRM: h }).status === 0)
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

// --- the hooks must be executable — git on Linux/macOS skips a non-executable hook with only a hint ---
if (process.platform !== 'win32') ok('githooks-executable', ['pre-push', 'commit-msg'].every(h => statSync(join(R2, 'githooks', h)).mode & 0o111))

// --- sentinel: deleting the snapshot is tamper (journal remembers), not "not installed" ---
const snapDir = join(HOME2, 'sentinel')
for (const f of readdirSync(snapDir).filter(f => f.endsWith('.json'))) rmSync(join(snapDir, f))
const gone = run(['node', 'scripts/gwork-sentinel.mjs', 'verify', '--json'], R2, { GWORK_HOME: HOME2 })
ok('sentinel-snapshot-deleted-is-tamper', gone.status === 2 && /DELETED/.test(gone.stdout), gone.stdout.slice(0, 80))
const never = run(['node', 'scripts/gwork-sentinel.mjs', 'verify', '--json'], R2, { GWORK_HOME: join(R2, '.no-such-home') })
ok('sentinel-never-installed-still-ok', never.status === 0 && /"installed":false/.test(never.stdout))

// --- tasklog-check C: an escaped pipe must not hide an over-long gotcha ---
const idxPath = join(R, 'task-log/INDEX.md'), idxSrc = readFileSync(idxPath, 'utf8')
writeFileSync(idxPath, idxSrc.trimEnd() + `\n| zz | [2026-07-10](task-log/2026-07.md#2026-07-10) | — | short \\| ${'x'.repeat(400)} |\n`)
const piped = run(['node', 'scripts/tasklog-check.mjs'], R)
ok('check-C-escaped-pipe-counted', piped.status === 1 && /C zz/.test(piped.stderr), piped.stderr.slice(0, 120))
writeFileSync(idxPath, idxSrc)

// --- migrate: refuses to overwrite an existing INDEX without --force ---
const mig = run(['node', join(KIT, 'scripts/migrate.mjs'), 'nope.md'], R)
ok('migrate-refuses-existing-index', mig.status === 1 && /already exists/.test(mig.stderr) && readFileSync(idxPath, 'utf8') === idxSrc)

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

// --- the Claude hook never answers "allow": that would skip the user's permission prompt ---
o = feed(CL, { tool_input: { file_path: `${winR}/lib/util.js`, content: 'x' }, cwd: winR, session_id: 'u7' })
ok('edit-claude-silent-when-nothing-to-say', o.trim() === '', o.slice(0, 80))
o = feed(CL, { tool_input: { file_path: `${winR}/lib/money/display.js`, content: 'x' }, cwd: winR, session_id: `u8-${process.pid}-${Date.now()}` })
ok('edit-claude-gotcha-without-permission-decision', /additionalContext/.test(o) && /formatMoney/.test(o) && !/permissionDecision/.test(o), o.slice(0, 120))

// --- hooks resolve the repo from the edited file, not from cwd (session started elsewhere) ---
o = feed(CL, { tool_input: { file_path: `${winR}/lib/money/display.js`, content: 'const d=n=>n.toFixed(2)' }, cwd: KIT, session_id: 'u4' })
ok('edit-claude-root-from-file-not-cwd', /"permissionDecision":"deny"/.test(o), o.slice(0, 80))
o = feed(HE, { tool_name: 'write_file', tool_input: { path: `${winR}/lib/money/display.js`, content: 'const d=n=>n.toFixed(2)' }, cwd: KIT, session_id: 'u5' })
ok('edit-hermes-root-from-file-not-cwd', /"action":"block"/.test(o), o.slice(0, 80))
o = feed(CL, { tool_input: { file_path: 'lib/money/display.js', content: 'const d=n=>n.toFixed(2)' }, cwd: winR, session_id: 'u6' })
ok('edit-claude-relative-path-denied', /"permissionDecision":"deny"/.test(o), o.slice(0, 80))

// --- pre-push / check G / shell-safety: a sentinel-free sandbox with a real remote ---
execSync(`node "${join(E2E, 'setup.mjs')}" s9 1`, { cwd: KIT, stdio: 'ignore' })
const R3 = join(SB, 'run-s9-1'), noSentinel = { GWORK_HOME: join(R3, '.no-such-home') }
const check3 = () => run(['node', 'scripts/tasklog-check.mjs'], R3)
const commit = (msg) => spawnSync('git', ['commit', '-q', '-a', '--no-verify', '-m', msg], { cwd: R3, encoding: 'utf8' })

// a branch that is not checked out carries a commit the checks never saw → blocked; HEAD still pushes
sh('git checkout -q -b side && git commit -q --allow-empty -m "chore: side" && git checkout -q main', R3)
const sidePush = run(['git', 'push', 'origin', 'side'], R3, noSentinel)
ok('prepush-blocks-ref-that-is-not-head', sidePush.status !== 0 && /not the checked-out commit/.test(sidePush.stderr), sidePush.stderr.slice(0, 120))
sh('git commit -q --allow-empty -m "chore: head"', R3)
ok('prepush-allows-head', run(['git', 'push', 'origin', 'main'], R3, noSentinel).status === 0)
sh('git tag old HEAD~1', R3)
ok('prepush-allows-tag-of-pushed-commit', run(['git', 'push', 'origin', 'old'], R3, noSentinel).status === 0)

// check G: an owner-approved removal stays approved when a later commit touches gwork.json
const cfg3Path = join(R3, 'gwork.json'), cfg3 = JSON.parse(readFileSync(cfg3Path, 'utf8'))
const writeCfg = (c) => writeFileSync(cfg3Path, JSON.stringify(c, null, 2) + '\n')
writeCfg({ ...cfg3, forbidden: [] }); commit('chore: lift rule\n\nGwork-Owner-Approved: test')
writeCfg({ ...cfg3, forbidden: [], commit: { types: ['feat', 'fix', 'chore'] } }); commit('chore: unrelated config edit')
let g = check3()
ok('check-G-approval-survives-later-commit', !/^\s*G gwork\.json/m.test(g.stderr), g.stderr.slice(0, 160))
// ...and a trailer-free removal is blocked even when an EARLIER commit on the file carried a trailer
sh('git reset -q --hard origin/main', R3)
writeCfg({ ...cfg3, commit: { types: ['feat', 'fix', 'chore'] } }); commit('chore: unrelated\n\nGwork-Owner-Approved: something else')
writeCfg({ ...cfg3, forbidden: [], commit: { types: ['feat', 'fix', 'chore'] } }); commit('chore: quiet removal')
g = check3()
ok('check-G-unapproved-removal-blocked', g.status === 1 && /G gwork\.json/.test(g.stderr), g.stderr.slice(0, 160))
sh('git reset -q --hard origin/main', R3)

// an anchor id is data: shell metacharacters in a shard must never execute
const shard3 = join(R3, 'task-log/2026-07.md')
writeFileSync(shard3, readFileSync(shard3, 'utf8') + '\n<a id="2026-07-11$(touch pwned)"></a>\n## 2026-07-11 — x\n')
commit('docs: entry')
const hRun = check3()
ok('check-H-anchor-id-not-executed', !existsSync(join(R3, 'pwned')))
ok('check-H-blocks-backdated-entry', hRun.status === 1 && /^\s*H 2026-07\.md#/m.test(hRun.stderr), hRun.stderr.slice(0, 160))

// --- checks A, B, D, F: one blocking case each (C, G, H have theirs above) ---
sh('git reset -q --hard origin/main', R3)
const idx3Path = join(R3, 'task-log/INDEX.md'), idx3 = readFileSync(idx3Path, 'utf8'), shard3Src = readFileSync(shard3, 'utf8')
const errs = () => { const r = check3(); return r.status === 1 ? r.stderr : '' }
ok('check-baseline-green', check3().status === 0)
writeFileSync(shard3, shard3Src + '\n<a id="2026-07-12"></a>\n## 2026-07-12 — unindexed\n')
ok('check-A-blocks-unreferenced-entry', /^\s*A 2026-07\.md#2026-07-12/m.test(errs()))
writeFileSync(shard3, shard3Src)
writeFileSync(idx3Path, idx3.trimEnd() + '\n| ghost | [x](task-log/2026-07.md#no-such-anchor) | — | — |\n')
ok('check-B-blocks-rotten-link', /^\s*B ghost: .*no-such-anchor/m.test(errs()))
writeFileSync(idx3Path, idx3.trimEnd() + `\n| promoted | [2026-07-10](task-log/2026-07.md#2026-07-10) | BC-001 | ${'y'.repeat(100)} |\n`)
ok('check-D-blocks-long-gotcha-beside-BC', /^\s*D promoted: /m.test(errs()))
writeFileSync(idx3Path, idx3)
writeFileSync(join(R3, 'lib/money/total.js'), 'export const t = n => n.toFixed(2)\n')
sh('git add lib/money/total.js', R3); commit('feat: total')
ok('check-F-blocks-committed-forbidden-pattern', /^\s*F lib\/money\/total\.js:1 \(committed\)/m.test(errs()))
const redPush = run(['git', 'push', 'origin', 'main'], R3, noSentinel)
ok('prepush-blocks-when-a-check-fails', redPush.status !== 0 && /tasklog-check FAILED/.test(redPush.stderr), redPush.stderr.slice(0, 120))
sh('git reset -q --hard origin/main', R3)

// --- commit-msg: a real `git commit` through the hook (no case rejected a commit before) ---
const tryCommit = (msg) => spawnSync('git', ['commit', '-q', '--allow-empty', '-m', msg], { cwd: R3, encoding: 'utf8' })
ok('commit-msg-rejects-untyped', tryCommit('bad message').status !== 0)
ok('commit-msg-rejects-at-prefix', tryCommit('@fix: thing').status !== 0)
ok('commit-msg-rejects-unknown-type', tryCommit('wip: thing').status !== 0)
ok('commit-msg-accepts-typed', tryCommit('fix: thing').status === 0)
ok('commit-msg-accepts-scope', tryCommit('feat(money): thing').status === 0)
ok('commit-msg-accepts-git-generated', tryCommit('Revert "fix: thing"').status === 0)
writeFileSync(cfg3Path, '{ broken')
const badCfg = tryCommit('fix: thing')
ok('commit-msg-blocks-on-broken-config', badCfg.status !== 0 && /cannot parse gwork\.json/.test(badCfg.stderr), badCfg.stderr.slice(0, 100))
writeCfg(cfg3)

// --- gotcha hooks deliver EVERY row filed under the module, not just the first ---
writeFileSync(idxPath, idxSrc.trimEnd() + '\n| (shim) money | [2026-07-10](task-log/2026-07.md#2026-07-10) | BC-007 | second lesson: totals round half-even |\n')
const uniqSid = `multi-${process.pid}-${Date.now()}`
o = feed(CL, { tool_input: { file_path: `${winR}/lib/money/display.js`, content: 'x' }, cwd: winR, session_id: uniqSid })
ok('gotcha-claude-all-rows-of-module', /formatMoney/.test(o) && /half-even/.test(o) && /BC-007/.test(o), o.slice(0, 160))
o = feed(HE, { tool_name: 'write_file', tool_input: { path: `${winR}/lib/money/display.js`, content: 'x' }, cwd: winR, session_id: uniqSid })
ok('gotcha-hermes-all-rows-of-module', /formatMoney/.test(o) && /half-even/.test(o), o.slice(0, 160))

// --- checker notes INDEX rows no module rule can reach, without failing ---
const cfgR = JSON.parse(readFileSync(cfgPath, 'utf8'))
writeFileSync(cfgPath, JSON.stringify({ ...cfgR, modules: [{ pattern: '^lib/([\\w-]+)', name: '(shim) $1' }] }, null, 2) + '\n')
writeFileSync(idxPath, idxSrc.trimEnd() + '\n| checkout-flow | [2026-07-10](task-log/2026-07.md#2026-07-10) | — | filed under a topic, not a path |\n')
const note = run(['node', 'scripts/tasklog-check.mjs'], R)
ok('check-notes-unreachable-module-without-failing', note.status === 0 && /note: 1 of 2 INDEX module names/.test(note.stdout) && /checkout-flow/.test(note.stdout), (note.stdout + note.stderr).slice(0, 200))
writeFileSync(cfgPath, cfgSrc); writeFileSync(idxPath, idxSrc)

// --- checker notes modules that repeat gotchas without a BC, without failing ---
writeFileSync(idxPath, idxSrc.trimEnd() + '\n| (shim) money | [2026-07-10](task-log/2026-07.md#2026-07-10) | — | a second, different lesson |\n')
const bcNote = run(['node', 'scripts/tasklog-check.mjs'], R)
ok('check-notes-unpromoted-repeats', bcNote.status === 0 && /note: 1 modules hold 2\+ gotchas and no BC/.test(bcNote.stdout), (bcNote.stdout + bcNote.stderr).slice(0, 200))
writeFileSync(idxPath, idxSrc)

// --- drift detector: tells a copy that is merely behind from one edited in place ---
const DRIFT = join(KIT, 'scripts/gwork-drift.mjs')
const fakeClaude = join(SB, 'fake-claude')
rmSync(fakeClaude, { recursive: true, force: true })
mkdirSync(join(fakeClaude, 'hooks'), { recursive: true }); mkdirSync(join(fakeClaude, 'commands'), { recursive: true })
copyFileSync(join(KIT, 'hooks/tasklog-gotcha.mjs'), join(fakeClaude, 'hooks/tasklog-gotcha.mjs'))
for (const f of readdirSync(join(KIT, 'commands'))) copyFileSync(join(KIT, 'commands', f), join(fakeClaude, 'commands', f))
const drift = () => { const r = run(['node', DRIFT, '--repo', R3, '--json'], KIT, { GWORK_CLAUDE_HOME: fakeClaude }); let j = {}; try { j = JSON.parse(r.stdout) } catch {} ; return { code: r.status, j } }
sh('git reset -q --hard origin/main', R3)
let d = drift()
ok('drift-clean-install-is-clean', d.code === 0 && d.j.drift?.length === 0, JSON.stringify(d.j.drift ?? d.j).slice(0, 200))
const hookCopy = join(R3, 'githooks/pre-push')
writeFileSync(hookCopy, readFileSync(hookCopy, 'utf8') + '# fixed in place\n')
d = drift()
// in a shallow kit the detector cannot rule out "behind", and says so instead of crying "local edit"
const editedState = sh('git rev-parse --is-shallow-repository', KIT)?.trim() === 'true' ? 'differs' : 'local edit'
ok('drift-flags-local-edit', d.code === 1 && d.j.drift.some(r => r.file === 'githooks/pre-push' && r.state === editedState), JSON.stringify(d.j.drift).slice(0, 200))
// "behind" needs an OLDER committed version of the file, which a shallow or single-commit
// checkout does not have (the first CI run failed exactly here) — skip rather than fake it
const older = (sh('git log --format=%H -- githooks/pre-push', KIT) ?? '').trim().split('\n').filter(Boolean)
  .map(c => sh(`git show ${c}:githooks/pre-push`, KIT)).find(v => v && v.replace(/\r\n/g, '\n') !== readFileSync(join(KIT, 'githooks/pre-push'), 'utf8').replace(/\r\n/g, '\n'))
if (older) {
  writeFileSync(hookCopy, older)
  d = drift()
  ok('drift-flags-behind', d.code === 1 && d.j.drift.some(r => r.file === 'githooks/pre-push' && r.state === 'behind'), JSON.stringify(d.j.drift).slice(0, 200))
} else console.log('SKIP drift-flags-behind — kit checkout has no older version of githooks/pre-push')
sh('git checkout -q -- githooks/pre-push', R3)
rmSync(join(fakeClaude, 'hooks/tasklog-gotcha.mjs'))
d = drift()
ok('drift-flags-missing-machine-copy', d.code === 1 && d.j.drift.some(r => r.file === 'hooks/tasklog-gotcha.mjs' && r.state === 'missing'))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
