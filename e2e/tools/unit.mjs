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
// GWORK_HOME inside the sandbox: the hooks log every decision, and a test run must never write to the real ~/.gwork
const LOGHOME = join(SB, 'log-home')
rmSync(LOGHOME, { recursive: true, force: true })
// GWORK_KIT at nothing: the once-a-day drift notice must not fire from whatever kit this machine has installed
const HOOKENV = { ...process.env, GWORK_HOME: LOGHOME, GWORK_KIT: join(SB, 'no-kit') }
const feed = (hookRel, payload) => spawnSync('node', [join(KIT, hookRel)], { input: JSON.stringify(payload), encoding: 'utf8', env: HOOKENV }).stdout
const CL = 'hooks/tasklog-gotcha.mjs'

let o = feed(CL, { tool_input: { file_path: `${winR}/lib/money/display.js`, content: 'const d=n=>n.toFixed(2)' }, cwd: winR, session_id: 'u1' })
ok('edit-claude-forbidden-denies', /"permissionDecision":"deny"/.test(o) && /forbidden/i.test(o), o.slice(0, 80))

o = feed(CL, { tool_input: { file_path: `${winR}/lib/util.js`, content: 'const d=n=>n.toFixed(2)' }, cwd: winR, session_id: 'u2' })
ok('edit-claude-otherpath-allowed', !/"permissionDecision":"deny"/.test(o))


// --- the Claude hook never answers "allow": that would skip the user's permission prompt ---
o = feed(CL, { tool_input: { file_path: `${winR}/lib/util.js`, content: 'x' }, cwd: winR, session_id: 'u7' })
ok('edit-claude-silent-when-nothing-to-say', o.trim() === '', o.slice(0, 80))
o = feed(CL, { tool_input: { file_path: `${winR}/lib/money/display.js`, content: 'x' }, cwd: winR, session_id: `u8-${process.pid}-${Date.now()}` })
ok('edit-claude-gotcha-without-permission-decision', /additionalContext/.test(o) && /formatMoney/.test(o) && !/permissionDecision/.test(o), o.slice(0, 120))

// --- hooks resolve the repo from the edited file, not from cwd (session started elsewhere) ---
o = feed(CL, { tool_input: { file_path: `${winR}/lib/money/display.js`, content: 'const d=n=>n.toFixed(2)' }, cwd: KIT, session_id: 'u4' })
ok('edit-claude-root-from-file-not-cwd', /"permissionDecision":"deny"/.test(o), o.slice(0, 80))
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

// --- checker notes INDEX rows no module rule can reach, without failing ---
const cfgR = JSON.parse(readFileSync(cfgPath, 'utf8'))
writeFileSync(cfgPath, JSON.stringify({ ...cfgR, modules: [{ pattern: '^lib/([\\w-]+)', name: '(shim) $1' }] }, null, 2) + '\n')
writeFileSync(idxPath, idxSrc.trimEnd() + '\n| checkout-flow | [2026-07-10](task-log/2026-07.md#2026-07-10) | — | filed under a topic, not a path |\n')
const note = run(['node', 'scripts/tasklog-check.mjs'], R)
ok('check-notes-unreachable-module-without-failing', note.status === 0 && /note: 1 of 2 INDEX module names/.test(note.stdout) && /checkout-flow/.test(note.stdout), (note.stdout + note.stderr).slice(0, 200))
writeFileSync(cfgPath, cfgSrc); writeFileSync(idxPath, idxSrc)

// --- checker notes a lesson that REPEATS on a module (near-duplicate rows), not merely 2+ lessons ---
const moneyGotcha = idxSrc.split('\n').find(l => l.includes('(shim) money')).split('|')[4].trim()
writeFileSync(idxPath, idxSrc.trimEnd() + '\n| (shim) money | [2026-07-10](task-log/2026-07.md#2026-07-10) | — | a second, entirely different lesson about rounding totals |\n')
let rep = run(['node', 'scripts/tasklog-check.mjs'], R)
ok('check-distinct-lessons-are-not-a-repeat', rep.status === 0 && !/same lesson/.test(rep.stdout), rep.stdout.slice(0, 200))
writeFileSync(idxPath, idxSrc.trimEnd() + `\n| (shim) money | [2026-07-10](task-log/2026-07.md#2026-07-10) | — | ${moneyGotcha.replace('NEVER', 'never ever')} |\n`)
rep = run(['node', 'scripts/tasklog-check.mjs'], R)
ok('check-notes-a-repeated-lesson', rep.status === 0 && /note: 1 module\(s\) carry the same lesson/.test(rep.stdout), (rep.stdout + rep.stderr).slice(0, 200))
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

// ================= work-effectiveness round =================
const u = (tag) => `${tag}-${process.pid}-${Date.now()}`
const ctxOf = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext ?? '' } catch { return '' } }
const edit = (hook, file, sid, cwd = winR) => feed(hook, { tool_name: 'Edit', tool_input: { file_path: `${winR}/${file}`, new_string: 'x' }, cwd, session_id: sid })

// --- file-level injection: a row filed under a topic name is reached through the entry that names the file ---
const shardR = join(R, 'task-log/2026-07.md'), shardRSrc = readFileSync(shardR, 'utf8')
writeFileSync(shardR, shardRSrc.trimEnd() + '\n\n---\n\n<a id="2026-07-20"></a>\n## 2026-07-20 — checkout rework\n\n- **Files:** `lib/util.js`, and the helper `cart-totals-helper.js`\n')
writeFileSync(idxPath, idxSrc.trimEnd() + '\n| checkout-flow | [2026-07-20](task-log/2026-07.md#2026-07-20) | — | totals are recomputed server-side, never trusted from the client |\n')
let sFile = u('file')
o = edit(CL, 'lib/util.js', sFile)
ok('inject-file-level-by-full-path', /Earlier work touched lib\/util\.js/.test(ctxOf(o)) && /\[checkout-flow\] totals are recomputed/.test(ctxOf(o)) && !/permissionDecision/.test(o), o.slice(0, 160))
ok('inject-file-level-once-per-file', edit(CL, 'lib/util.js', sFile).trim() === '')
o = edit(CL, 'lib/deep/cart-totals-helper.js', sFile)
ok('inject-row-not-repeated-in-session', o.trim() === '', o.slice(0, 120))
o = edit(CL, 'lib/deep/cart-totals-helper.js', u('base'))
ok('inject-file-level-by-unique-basename', /totals are recomputed/.test(ctxOf(o)), o.slice(0, 160))
o = edit(CL, 'lib/utility.js', u('near'))
ok('inject-file-level-needs-whole-path', o.trim() === '', o.slice(0, 120))
writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(cfgSrc), tasklog: { fileInjection: false } }, null, 2) + '\n')
ok('inject-file-level-can-be-switched-off', edit(CL, 'lib/util.js', u('off')).trim() === '')
writeFileSync(cfgPath, cfgSrc)

// --- context cleared or compacted: what was "seen" is forgotten, so it is shown again ---
sFile = u('compact')
edit(CL, 'lib/util.js', sFile)
feed(CL, { hook_event_name: 'SessionStart', source: 'compact', cwd: winR, session_id: sFile })
ok('inject-again-after-compaction', /totals are recomputed/.test(ctxOf(edit(CL, 'lib/util.js', sFile))))

// --- a long entries cell cannot blow the context budget ---
const many = Array.from({ length: 300 }, (_, i) => `[2026-07-20](task-log/2026-07.md#2026-07-20)`).join(' · ')
writeFileSync(idxPath, idxSrc.trimEnd() + `\n| checkout-flow | ${many} | — | totals are recomputed server-side |\n`)
o = ctxOf(edit(CL, 'lib/util.js', u('budget')))
ok('inject-stays-inside-context-budget', o.length > 0 && o.length < 3000, `len ${o.length}`)
writeFileSync(idxPath, idxSrc); writeFileSync(shardR, shardRSrc)

// --- shell writes of forbidden content: denied for a write, untouched for a read ---
const bash = (command) => feed(CL, { tool_name: 'Bash', tool_input: { command }, cwd: winR, session_id: u('bash') })
ok('bash-denies-redirect-of-forbidden', /"permissionDecision":"deny"/.test(bash('echo "export const d = n => n.toFixed(2)" > lib/money/display.js')))
ok('bash-denies-heredoc-append', /"permissionDecision":"deny"/.test(bash("cat >> lib/money/display.js <<'X'\nn.toFixed(2)\nX")))
ok('bash-denies-sed-in-place', /"permissionDecision":"deny"/.test(bash("sed -i 's/fmt(n)/n.toFixed(2)/' lib/money/display.js")))
ok('bash-denies-tee', /"permissionDecision":"deny"/.test(bash('echo "n.toFixed(2)" | tee -a lib/money/display.js')))
ok('bash-allows-reading-the-pattern', bash('grep -n "\\.toFixed(" lib/money/display.js 2>&1 | head').trim() === '')
ok('bash-allows-write-elsewhere', bash('echo "n.toFixed(2)" > lib/other/display.js').trim() === '')
ok('bash-allows-unrelated-command', bash('git status && node -e "const f = n => n > 1"').trim() === '')

// --- every decision is logged, and the stats tool reads it back ---
const logFile = join(LOGHOME, 'log', `${new Date().toISOString().slice(0, 7)}.jsonl`)
const logged = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []
ok('log-records-inject-pass-deny', ['inject', 'pass', 'deny-forbidden', 'deny-bash-forbidden', 'reset-state'].every(a => logged.some(e => e.action === a)), [...new Set(logged.map(e => e.action))].join(','))
const stats = run(['node', join(KIT, 'scripts/gwork-stats.mjs'), '--all', '--json'], KIT, { GWORK_HOME: LOGHOME })
let st = {}; try { st = JSON.parse(stats.stdout) } catch {}
ok('stats-reads-the-log', st.injections?.total > 0 && st.denies?.forbiddenBash >= 4 && typeof st.hitRate === 'number', stats.stdout.slice(0, 160))
const quiet = spawnSync('node', [join(KIT, CL)], { input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: `${winR}/lib/money/display.js`, new_string: 'x' }, cwd: winR, session_id: u('nolog') }), encoding: 'utf8', env: { ...process.env, GWORK_HOME: join(SB, 'no-log-home'), GWORK_LOG: '0' } })
ok('log-can-be-switched-off', quiet.stdout.length > 0 && !existsSync(join(SB, 'no-log-home')))

// --- unclosed work: said once at session start, only past the threshold ---
sh('git reset -q --hard origin/main', R3)
const start = () => ctxOf(spawnSync('node', [join(KIT, CL)], { input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: R3, session_id: u('start') }), encoding: 'utf8', env: HOOKENV }).stdout)
ok('reminder-silent-when-closed-out', start() === '')
for (const n of [1, 2, 3]) { writeFileSync(join(R3, `lib/w${n}.js`), 'export {}\n'); sh(`git add lib/w${n}.js`, R3); commit(`feat: work ${n}`) }
ok('reminder-after-three-unlogged-commits', /\b[3-9] commits since the last task-log entry/.test(start()), start().slice(0, 120)) // the sandbox already carries one earlier unlogged commit

// --- close-out scaffold: computes id, files, commits, modules; the result passes the checker ---
const scaffold = (...a) => run(['node', join(KIT, 'scripts/gwork-log.mjs'), ...a], R3)
const planOut = scaffold('--title', 'three workers')
ok('scaffold-plan-changes-nothing', planOut.status === 0 && /nothing written/.test(planOut.stdout) && /lib\/w1\.js/.test(planOut.stdout) && sh('git status --porcelain', R3) === '', planOut.stdout.slice(0, 120))
const wrote = scaffold('--write', '--title', 'three workers')
const afterWrite = check3()
ok('scaffold-write-passes-the-checker', wrote.status === 0 && afterWrite.status === 0 && /feat: work 3/.test(readFileSync(join(R3, `task-log/${new Date().toISOString().slice(0, 7)}.md`), 'utf8')), (wrote.stderr + afterWrite.stderr).slice(0, 200))
const again = scaffold('--write', '--title', 'second of the day')
ok('scaffold-second-entry-gets-next-id', /-2 to task-log/.test(again.stdout) && check3().status === 0, again.stdout.slice(0, 120))
ok('reminder-clears-after-close-out', (sh('git add -A && git commit -q --no-verify -m "docs: close out"', R3), start() === ''))

// --- pre-commit: a forbidden pattern is refused at the commit that adds it ---
sh('git reset -q --hard origin/main', R3)
writeFileSync(join(R3, 'lib/money/staged.js'), 'export const s = n => n.toFixed(2)\n')
sh('git add lib/money/staged.js', R3)
const badCommit = spawnSync('git', ['commit', '-q', '-m', 'feat: staged'], { cwd: R3, encoding: 'utf8' })
ok('precommit-blocks-staged-forbidden', badCommit.status !== 0 && /F lib\/money\/staged\.js:1 \(staged\)/.test(badCommit.stderr), badCommit.stderr.slice(0, 160))
writeFileSync(join(R3, 'lib/money/staged.js'), 'export const s = n => formatMoney(n)\n')
sh('git add lib/money/staged.js', R3)
ok('precommit-allows-clean-commit', spawnSync('git', ['commit', '-q', '-m', 'feat: staged'], { cwd: R3, encoding: 'utf8' }).status === 0)
sh('git reset -q --hard origin/main', R3)

// --- installer: one command, idempotent, and it never overwrites a fix made in place ---
const IR = join(SB, 'install-repo'), IC = join(SB, 'install-claude')
rmSync(IR, { recursive: true, force: true }); rmSync(IC, { recursive: true, force: true })
mkdirSync(IR, { recursive: true }); mkdirSync(IC, { recursive: true })
sh('git init -q -b main', IR)
writeFileSync(join(IC, 'settings.json'), JSON.stringify({ theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }] } }))
const install = (...a) => run(['node', join(KIT, 'scripts/gwork-install.mjs'), '--repo', IR, ...a], KIT, { GWORK_CLAUDE_HOME: IC })
ok('install-dry-run-changes-nothing', install('--machine', '--dry-run').status === 0 && !existsSync(join(IR, 'githooks')) && !existsSync(join(IC, 'hooks')))
const inst = install('--machine')
const set1 = JSON.parse(readFileSync(join(IC, 'settings.json'), 'utf8'))
ok('install-places-repo-half', inst.status === 0 && sh('git config core.hooksPath', IR)?.trim() === 'githooks' && existsSync(join(IR, 'task-log/INDEX.md')) && (process.platform === 'win32' || ['pre-push', 'commit-msg', 'pre-commit'].every(h => statSync(join(IR, 'githooks', h)).mode & 0o111)), inst.stderr.slice(0, 160))
ok('install-registers-hooks-and-keeps-other-settings', set1.theme === 'dark' && set1.hooks.PreToolUse.some(e => e.command === undefined && e.hooks[0].command === 'echo other') && set1.hooks.PreToolUse.some(e => e.matcher === 'Edit|Write|MultiEdit|Bash') && ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'Stop'].every(e => set1.hooks[e]?.length) && existsSync(join(IC, 'settings.json.gwork-bak')))
const inst2 = install('--machine')
ok('install-is-idempotent', inst2.status === 0 && /already up to date/.test(inst2.stdout) && readFileSync(join(IC, 'settings.json'), 'utf8') === JSON.stringify(set1, null, 2) + '\n', inst2.stdout.slice(0, 200))
ok('install-result-has-no-drift', run(['node', DRIFT, '--repo', IR], KIT, { GWORK_CLAUDE_HOME: IC }).status === 0)
writeFileSync(join(IR, 'githooks/pre-push'), readFileSync(join(IR, 'githooks/pre-push'), 'utf8') + '# fixed in place\n')
const inst3 = install()
ok('install-refuses-to-overwrite-local-edit', inst3.status === 2 && /edited in place/.test(inst3.stdout) && /fixed in place/.test(readFileSync(join(IR, 'githooks/pre-push'), 'utf8')), inst3.stdout.slice(0, 200))
sh('git config core.hooksPath .husky', IR)
const inst4 = install()
ok('install-refuses-foreign-hookspath', inst4.status === 1 && /already "\.husky"/.test(inst4.stderr) && sh('git config core.hooksPath', IR)?.trim() === '.husky')

// --- check F and the edit hook judge a pattern with the SAME engine ---
// a variable-length lookbehind is valid JavaScript and invalid PCRE: under `git grep -P` this rule
// made the whole check fail, while the edit hook enforced it
sh('git reset -q --hard origin/main', R3)
const cfgF = JSON.parse(readFileSync(cfg3Path, 'utf8'))
writeCfg({ ...cfgF, forbidden: [...cfgF.forbidden, { path: '^lib/pay/', pattern: '(?<=amount\\s*\\.\\s*)round\\($', reason: 'js-only syntax' }] })
mkdirSync(join(R3, 'lib/pay'), { recursive: true })
writeFileSync(join(R3, 'lib/pay/a.js'), 'const ok = 1\r\nconst x = amount . round(\r\n  2)\r\n')
writeFileSync(join(R3, 'lib/pay/blob.bin'), Buffer.from([0x61, 0x00, 0x62]))
sh('git add -A', R3); commit('feat: pay')
let fOut = errs()
ok('check-F-uses-the-js-engine', /^\s*F lib\/pay\/a\.js:2 \(committed\) matches forbidden pattern/m.test(fOut) && !/could not read|git grep failed/.test(fOut), fOut.slice(0, 200))
ok('check-F-skips-binary-files', !/blob\.bin/.test(fOut))
o = feed(CL, { tool_name: 'Write', tool_input: { file_path: `${R3}/lib/pay/b.js`, content: 'amount.round(' }, cwd: R3, session_id: u('eng') })
ok('edit-hook-agrees-with-check-F', /"permissionDecision":"deny"/.test(o), o.slice(0, 120))
sh('git rm -q --cached lib/pay/a.js', R3)
const stagedDel = run(['node', 'scripts/tasklog-check.mjs', '--staged'], R3)
ok('check-F-staged-ignores-a-deleted-file', stagedDel.status === 0, stagedDel.stderr.slice(0, 160))
sh('git reset -q --hard origin/main && git clean -fdq', R3)

// --- a gwork.json that cannot be parsed is said out loud at edit time, once ---
writeFileSync(cfgPath, '{ "forbidden": [')
const sBroken = u('broken')
o = ctxOf(edit(CL, 'lib/whatever.js', sBroken))
ok('edit-hook-warns-on-broken-config', /gwork\.json cannot be parsed/.test(o) && /NOT checked/.test(o), o.slice(0, 160))
ok('edit-hook-warns-on-broken-config-once', edit(CL, 'lib/whatever2.js', sBroken).trim() === '')
writeFileSync(cfgPath, cfgSrc)

// --- drift: another checkout of the kit is source, not an install ---
const kitRun = run(['node', DRIFT, '--repo', KIT, '--json'], KIT, { GWORK_CLAUDE_HOME: IC })
ok('drift-kit-checkout-is-not-an-install', (() => { try { const j = JSON.parse(kitRun.stdout); return j.repo === null && !j.drift.some(r => r.group === 'repo') } catch { return false } })(), kitRun.stdout.slice(0, 160))

// --- check G2: a real gotcha may not be blanked without the owner; promotion to a BC is fine ---
sh('git reset -q --hard origin/main', R3)
const idxG = readFileSync(idx3Path, 'utf8')
const moneyRow = idxG.split('\n').find(l => l.includes('(shim) money'))
const withRow = (cells) => idxG.replace(moneyRow, moneyRow.split('|').map((c, i) => cells[i] ?? c).join('|'))
writeFileSync(idx3Path, withRow({ 4: ' — ' })); commit('docs: tidy index')
ok('check-G2-blocks-blanked-gotcha', /^\s*G \(shim\) money: gotcha .* was blanked/m.test(errs()), errs().slice(0, 200))
sh('git reset -q --hard origin/main', R3)
writeFileSync(idx3Path, withRow({ 4: ' — ' })); commit('docs: tidy index\n\nGwork-Owner-Approved: superseded')
ok('check-G2-allows-owner-approved-blanking', !/^\s*G /m.test(errs()))
sh('git reset -q --hard origin/main', R3)
writeFileSync(idx3Path, withRow({ 3: ' BC-001 ', 4: ' — ' })); commit('docs: promote to BC')
ok('check-G2-allows-promotion-to-BC', !/^\s*G /m.test(errs()))

// --- check H exemptions: an owner-approved late entry, and a brand-new shard (bulk import) ---
sh('git reset -q --hard origin/main', R3)
writeFileSync(shard3, readFileSync(shard3, 'utf8') + '\n<a id="2026-07-13"></a>\n## 2026-07-13 — logged late\n')
commit('docs: late entry\n\nGwork-Owner-Approved: logged after the fact')
ok('check-H-allows-owner-approved-late-entry', !/^\s*H /m.test(errs()))
sh('git reset -q --hard origin/main', R3)
writeFileSync(join(R3, 'task-log/2026-01.md'), '<a id="2026-01-05"></a>\n## 2026-01-05 — imported\n')
sh('git add task-log/2026-01.md', R3); commit('docs: import old shard')
ok('check-H-exempts-a-new-shard', !/^\s*H /m.test(errs()))
sh('git reset -q --hard origin/main', R3)

// --- migrate: a real CRLF log becomes shards + an INDEX the checker accepts ---
const MG = join(SB, 'migrate-repo')
rmSync(MG, { recursive: true, force: true }); mkdirSync(MG, { recursive: true })
writeFileSync(join(MG, 'old log.md'), ['# log', '', '## 2026-03-02 — first', 'touched `lib/money/format.ts`, see BC-004', '', '## 2026-03-02 — second same day', 'touched modules/visit/save.ts', '', '## 2026-04-10 (2) — numbered', 'no paths here', ''].join('\r\n'))
const mig2 = run(['node', join(KIT, 'scripts/migrate.mjs'), 'old log.md'], MG)
const migIdx = existsSync(join(MG, 'task-log/INDEX.md')) ? readFileSync(join(MG, 'task-log/INDEX.md'), 'utf8') : ''
ok('migrate-splits-a-crlf-log', mig2.status === 0 && /parsed 3 entries/.test(mig2.stdout) && existsSync(join(MG, 'task-log/2026-03.md')) && existsSync(join(MG, 'task-log/2026-04.md')), mig2.stdout.slice(0, 120))
ok('migrate-index-maps-modules-and-ids', /\| \(shim\) money \| \[2026-03-02\]/.test(migIdx) && /BC-004/.test(migIdx) && /\| visit \| \[2026-03-02-a\]/.test(migIdx) && /\| misc \| \[2026-04-10-2\]/.test(migIdx), migIdx.slice(-300))
copyFileSync(join(KIT, 'scripts/tasklog-check.mjs'), join(MG, 'tasklog-check.mjs'))
const migCheck = run(['node', 'tasklog-check.mjs'], MG)
ok('migrate-output-passes-the-checker', migCheck.status === 0, (migCheck.stdout + migCheck.stderr).slice(0, 200))
ok('migrate-leaves-the-source-untouched', readFileSync(join(MG, 'old log.md'), 'utf8').includes('\r\n## 2026-04-10 (2)'))

// --- sentinel: install copies the script; a snapshot from before pre-commit was watched still verifies ---
const SH = join(SB, 'sentinel-home')
rmSync(SH, { recursive: true, force: true })
copyFileSync(join(KIT, 'scripts/gwork-sentinel.mjs'), join(R3, 'scripts/gwork-sentinel.mjs'))
const sEnv = { GWORK_HOME: SH, CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '' }
const sRun = (...a) => run(['node', 'scripts/gwork-sentinel.mjs', ...a], R3, sEnv)
ok('sentinel-install-copies-the-script', sRun('install').status === 0 && existsSync(join(SH, 'bin/gwork-sentinel.mjs')))
ok('sentinel-verify-before-init-is-not-installed', sRun('verify').status === 0 && /not installed/.test(sRun('verify').stdout))
ok('sentinel-init-with-owner-hash', run(['node', 'scripts/gwork-sentinel.mjs', 'init'], R3, { ...sEnv, GWORK_SENTINEL_CONFIRM: sRun('hash').stdout.trim() }).status === 0 && sRun('verify').status === 0)
const snapFile = join(SH, 'sentinel', readdirSync(join(SH, 'sentinel')).find(f => f.endsWith('.json')))
const snapOld = JSON.parse(readFileSync(snapFile, 'utf8')); delete snapOld.state.files['githooks/pre-commit']
rmSync(join(R3, 'githooks/pre-commit')); writeFileSync(snapFile, JSON.stringify(snapOld))
ok('sentinel-older-snapshot-without-pre-commit-still-verifies', sRun('verify').status === 0, sRun('verify').stderr.slice(0, 160))
sh('git checkout -q -- githooks/pre-commit', R3); rmSync(join(R3, 'scripts/gwork-sentinel.mjs'))
ok('sentinel-flags-pre-commit-appearing', run(['node', join(SH, 'bin/gwork-sentinel.mjs'), 'verify', '--repo', R3], R3, sEnv).status === 2)

// --- session-start drift notice: once a day, only when there is something to say ---
sh('git reset -q --hard origin/main', R3)
writeFileSync(join(R3, 'githooks/commit-msg'), readFileSync(join(R3, 'githooks/commit-msg'), 'utf8') + '# fixed in place\n')
const DH = join(SB, 'drift-home')
rmSync(DH, { recursive: true, force: true })
const sessStart = (env = {}) => ctxOf(spawnSync('node', [join(KIT, CL)], { input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: R3, session_id: u('dn') }), encoding: 'utf8', env: { ...process.env, GWORK_HOME: DH, GWORK_KIT: KIT, GWORK_CLAUDE_HOME: IC, ...env } }).stdout)
const firstNotice = sessStart()
ok('drift-notice-at-session-start', /\[gwork\] installed copies: .*(edited in place|differing)/.test(firstNotice), firstNotice.slice(0, 200))
ok('drift-notice-once-a-day', !/installed copies/.test(sessStart()))
rmSync(DH, { recursive: true, force: true })
writeCfg({ ...cfg3, driftNotice: false })
ok('drift-notice-can-be-switched-off', !/installed copies/.test(sessStart()))
sh('git checkout -q -- githooks/commit-msg gwork.json', R3)

// --- server-side check: --ci places the workflow; GWORK_BASE gives a detached checkout a baseline ---
const ci1 = install('--ci', '--force')
ok('install-ci-places-the-workflow', existsSync(join(IR, '.github/workflows/gwork-check.yml')) && /Server-side check placed/.test(ci1.stdout), (ci1.stdout + ci1.stderr).slice(0, 200))
sh('git reset -q --hard origin/main', R3)
writeCfg({ ...cfg3, forbidden: [] }); commit('chore: quiet removal')
const headSha = sh('git rev-parse HEAD', R3).trim()
sh(`git checkout -q --detach ${headSha}`, R3)
const detached = run(['node', 'scripts/tasklog-check.mjs'], R3)
const withBase = run(['node', 'scripts/tasklog-check.mjs'], R3, { GWORK_BASE: 'origin/main' })
ok('ci-baseline-makes-check-G-run-on-a-detached-head', !/^\s*G /m.test(detached.stderr) && /^\s*G gwork\.json/m.test(withBase.stderr), (detached.stderr + '|' + withBase.stderr).slice(0, 200))
sh('git checkout -q main && git reset -q --hard origin/main', R3)

// --- machine-only: no repo needed, nothing written outside the Claude home ---
const IC2 = join(SB, 'install-claude-2')
rmSync(IC2, { recursive: true, force: true })
const mo = run(['node', join(KIT, 'scripts/gwork-install.mjs'), '--machine-only'], KIT, { GWORK_CLAUDE_HOME: IC2 })
ok('install-machine-only-needs-no-repo', mo.status === 0 && existsSync(join(IC2, 'hooks/tasklog-gotcha.mjs')) && JSON.parse(readFileSync(join(IC2, 'settings.json'), 'utf8')).hooks.SessionStart.length === 2 && sh('git status --porcelain', KIT).split('\n').every(l => !/githooks|task-log/.test(l) || l.startsWith(' M') || l === ''), (mo.stdout + mo.stderr).slice(0, 200))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
