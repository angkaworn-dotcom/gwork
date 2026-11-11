#!/usr/bin/env node
/**
 * unit-model-profile.mjs — deterministic cases for hooks/model-profile.mjs.
 * No network, no live agent: transcripts are synthesised fixtures. Run from the kit root:
 *   node e2e/tools/unit-model-profile.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const KIT = fileURLToPath(new URL('../..', import.meta.url))
const HOOK = join(KIT, 'hooks', 'model-profile.mjs')
const PROFILES = join(KIT, 'profiles')

const work = mkdtempSync(join(tmpdir(), 'gwork-profile-test-'))
const transcript = (lines) => {
  const p = join(work, `t${Math.random().toString(36).slice(2)}.jsonl`)
  writeFileSync(p, lines.map(o => JSON.stringify(o)).join('\n') + '\n')
  return p
}
const assistant = (model, extra = {}) => ({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'hi' }] }, ...extra })
const switched = (to) => ({ type: 'user', message: { content: `<local-command-stdout>Set model to ${to}</local-command-stdout>` } })

let n = 0, fail = 0
const run = (payload, env = {}) => {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, GWORK_PROFILES: PROFILES, ...env },
  })
  return { out: r.stdout.trim(), err: r.stderr.trim(), code: r.status,
    ctx: (() => { try { const j = JSON.parse(r.stdout); return j.additionalContext ?? j.hookSpecificOutput?.additionalContext ?? '' } catch { return '' } })() }
}
// Unique per run: the hook keeps "already injected" state per session_id in a shared tmp dir,
// so reusing fixed ids makes the second run of this suite fail against a correct hook.
const RUN = `${process.pid}-${Date.now().toString(36)}`
const sid = () => `test-${RUN}-${++n}`
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// --- resolution ---
const t1 = transcript([assistant('claude-opus-5')])
const r1 = run({ hook_event_name: 'UserPromptSubmit', session_id: sid(), cwd: work, transcript_path: t1 })
check('assistant model → matching profile', /verification layer/.test(r1.ctx), r1.out.slice(0, 200))

// a /model switch is recorded before the next assistant turn — must win over the older assistant line
const t2 = transcript([assistant('claude-opus-5'), switched('claude-fable-5')])
const r2 = run({ hook_event_name: 'UserPromptSubmit', session_id: sid(), cwd: work, transcript_path: t2 })
check('mid-session /model switch wins over the last assistant turn', /is your memory/.test(r2.ctx), r2.out.slice(0, 200))

// the switch line must not be matched by substring: an agent grepping for it writes the same text into tool results
const t3 = transcript([
  assistant('claude-opus-5'),
  { type: 'user', message: { content: [{ type: 'tool_result', content: '"Set model to claude-fable-5"' }] } },
])
const r3 = run({ hook_event_name: 'UserPromptSubmit', session_id: sid(), cwd: work, transcript_path: t3 })
check('"Set model to" inside a tool result is not a switch', /verification layer/.test(r3.ctx), r3.out.slice(0, 200))

// subagent turns carry their own model — they must not shadow the main model
const t4 = transcript([assistant('claude-opus-5'), assistant('claude-haiku-4-5-20251001', { isSidechain: true })])
const r4 = run({ hook_event_name: 'UserPromptSubmit', session_id: sid(), cwd: work, transcript_path: t4 })
check('sidechain (subagent) turns are skipped', /verification layer/.test(r4.ctx), r4.out.slice(0, 200))

// --- shapes ---
const r5 = run({ hook_event_name: 'SessionStart', session_id: sid(), cwd: work, model: 'claude-sonnet-5', source: 'startup' })
// top-level additionalContext is ignored by the harness without an error — every event nests it
const j5 = JSON.parse(r5.out || '{}')
check('SessionStart nests additionalContext in hookSpecificOutput', j5.additionalContext === undefined && j5.hookSpecificOutput?.hookEventName === 'SessionStart' && /scope boundaries/.test(r5.ctx))
const r6 = run({ hook_event_name: 'UserPromptSubmit', session_id: sid(), cwd: work, transcript_path: t1 })
check('UserPromptSubmit emits hookSpecificOutput', JSON.parse(r6.out || '{}').hookSpecificOutput?.hookEventName === 'UserPromptSubmit')
const r7 = run({ hook_event_name: 'SubagentStart', session_id: sid(), cwd: work })
check('SubagentStart → subagent profile, no model needed', /Never commit or push/.test(r7.ctx), r7.out.slice(0, 200))
check('SubagentStart nests additionalContext too', JSON.parse(r7.out || '{}').hookSpecificOutput?.hookEventName === 'SubagentStart')

// --- anti-spam ---
const s = sid()
run({ hook_event_name: 'UserPromptSubmit', session_id: s, cwd: work, transcript_path: t1 })
const r8 = run({ hook_event_name: 'UserPromptSubmit', session_id: s, cwd: work, transcript_path: t1 })
check('same model twice → injected once', r8.out === '', r8.out.slice(0, 200))
const t9 = transcript([assistant('claude-opus-5'), switched('claude-fable-5')])
const r9 = run({ hook_event_name: 'UserPromptSubmit', session_id: s, cwd: work, transcript_path: t9 })
check('switching back mid-session re-injects', /is your memory/.test(r9.ctx), r9.out.slice(0, 200))

// --- fail-open ---
const r10 = run({ hook_event_name: 'SessionStart', session_id: sid(), cwd: work, model: 'claude-nextgen-9' })
check('unknown model → silent, never a guessed profile', r10.out === '', r10.out.slice(0, 200))
const r11 = run({ hook_event_name: 'UserPromptSubmit', session_id: sid(), cwd: work, transcript_path: join(work, 'missing.jsonl') })
check('missing transcript → silent, exit 0', r11.out === '' && r11.code === 0, JSON.stringify(r11))
const r12 = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' })
check('garbage stdin → exit 0, no output', r12.status === 0 && r12.stdout.trim() === '')
const r13 = run({ hook_event_name: 'PreToolUse', session_id: sid(), cwd: work, tool_name: 'Edit' })
check('unrelated event ignored', r13.out === '')

// truncated first record (tail read) must not crash the scan
const t14 = transcript([assistant('claude-opus-5')])
writeFileSync(t14, '{"type":"assis' + '\n' + JSON.stringify(assistant('claude-opus-5')) + '\n')
const r14 = run({ hook_event_name: 'UserPromptSubmit', session_id: sid(), cwd: work, transcript_path: t14 })
check('unparseable line is skipped, scan continues', /verification layer/.test(r14.ctx), r14.out.slice(0, 200))

// A /model switch is only visible in the prompt text at the moment it happens — the transcript
// still shows the old model when UserPromptSubmit fires (measured against a real session).
const sSwitch = sid()
const rBefore = run({ hook_event_name: 'UserPromptSubmit', session_id: sSwitch, cwd: work, transcript_path: t1, prompt: 'do the thing' })
check('baseline: transcript model injected', /verification layer/.test(rBefore.ctx), rBefore.out.slice(0, 200))
const rSwitch = run({ hook_event_name: 'UserPromptSubmit', session_id: sSwitch, cwd: work, transcript_path: t1, prompt: '/model claude-fable-5' })
check('/model prompt beats the stale transcript model', /is your memory/.test(rSwitch.ctx), rSwitch.out.slice(0, 200))
check('switch says the old profile no longer applies', /profile above for opus-5 no longer applies/.test(rSwitch.ctx), rSwitch.ctx.slice(0, 160))
const rProse = run({ hook_event_name: 'UserPromptSubmit', session_id: sid(), cwd: work, transcript_path: t1, prompt: 'should I /model claude-fable-5 or not?' })
check('/model mentioned mid-sentence is not a switch', /verification layer/.test(rProse.ctx), rProse.out.slice(0, 200))

// PreToolUse is the backstop: it fires mid-turn, once the switch is in the transcript
const sTool = sid()
const rTool = run({ hook_event_name: 'PreToolUse', session_id: sTool, cwd: work, transcript_path: t2, tool_name: 'Bash' })
check('PreToolUse catches a switch mid-turn', /is your memory/.test(rTool.ctx), rTool.out.slice(0, 200))
check('PreToolUse wraps with its own event name', JSON.parse(rTool.out || '{}').hookSpecificOutput?.hookEventName === 'PreToolUse')
const rTool2 = run({ hook_event_name: 'PreToolUse', session_id: sTool, cwd: work, transcript_path: t2, tool_name: 'Bash' })
check('PreToolUse silent on every later tool call', rTool2.out === '', rTool2.out.slice(0, 200))

// Stop closes the no-tool-turn gap: a text-only turn after a switch never fires PreToolUse,
// so the end of that turn is the last chance to have the profile in place before the next one
const sStop = sid()
run({ hook_event_name: 'UserPromptSubmit', session_id: sStop, cwd: work, transcript_path: t1, prompt: 'hi' })
const rStop = run({ hook_event_name: 'Stop', session_id: sStop, cwd: work, transcript_path: t2 })
check('Stop injects a switch the turn never revealed', /is your memory/.test(rStop.ctx), rStop.out.slice(0, 200))
check('Stop wraps with its own event name', JSON.parse(rStop.out || '{}').hookSpecificOutput?.hookEventName === 'Stop')
const rStop2 = run({ hook_event_name: 'Stop', session_id: sStop, cwd: work, transcript_path: t2 })
check('Stop silent when nothing changed', rStop2.out === '', rStop2.out.slice(0, 200))

// /clear wipes the context but not the state file — SessionStart(source:clear) must reset it
const sClear = sid()
run({ hook_event_name: 'UserPromptSubmit', session_id: sClear, cwd: work, transcript_path: t1 })
run({ hook_event_name: 'SessionStart', session_id: sClear, cwd: work, source: 'clear' }) // no model field, like a real clear
const rClear = run({ hook_event_name: 'UserPromptSubmit', session_id: sClear, cwd: work, transcript_path: t1 })
check('after /clear the profile is re-injected', /verification layer/.test(rClear.ctx), rClear.out.slice(0, 200))

// --- per-repo opt-out ---
const optOut = join(work, 'optout')
mkdirSync(optOut, { recursive: true })
writeFileSync(join(optOut, 'gwork.json'), JSON.stringify({ profiles: false }))
const r15 = run({ hook_event_name: 'SessionStart', session_id: sid(), cwd: optOut, model: 'claude-opus-5' })
check('gwork.json profiles:false disables injection', r15.out === '', r15.out.slice(0, 200))

// --- per-repo override dir wins over the machine copy ---
const ovRepo = join(work, 'override')
mkdirSync(join(ovRepo, 'myprofiles'), { recursive: true })
writeFileSync(join(ovRepo, 'gwork.json'), JSON.stringify({ profilesDir: 'myprofiles' }))
writeFileSync(join(ovRepo, 'myprofiles', 'opus-5.md'), 'REPO OVERRIDE RULE')
const r16 = run({ hook_event_name: 'SessionStart', session_id: sid(), cwd: ovRepo, model: 'claude-opus-5' }, { GWORK_PROFILES: '' })
check('repo profilesDir overrides the machine copy', /REPO OVERRIDE RULE/.test(r16.ctx), r16.out.slice(0, 200))

// --- minor revisions: a release with no profile of its own reads its family's ---
const r17 = run({ hook_event_name: 'SessionStart', session_id: sid(), cwd: work, model: 'claude-fable-5-2' })
check('minor revision falls back to the family profile', /is your memory/.test(r17.ctx) && /claude-fable-5-2/.test(r17.ctx), r17.out.slice(0, 200))
const r18 = run({ hook_event_name: 'SessionStart', session_id: sid(), cwd: work, model: 'claude-haiku-4-5-20251001' })
check('exact profile still wins over the family fallback', /haiku|small/i.test(r18.ctx) && !/is your memory/.test(r18.ctx), r18.out.slice(0, 200))
const r19 = run({ hook_event_name: 'SessionStart', session_id: sid(), cwd: work, model: 'claude-opus-5[1m]' })
check('[1m] context suffix is not part of the model key', /verification layer/.test(r19.ctx), r19.out.slice(0, 200))
const t20 = transcript([assistant('claude-opus-5'), switched('`claude-fable-5-2`')])
const r20 = run({ hook_event_name: 'PreToolUse', session_id: sid(), cwd: work, transcript_path: t20 })
check('backticked id in the switch record is still a switch', /is your memory/.test(r20.ctx), r20.out.slice(0, 200))

// --- PostModelSwitch: the documented channel — no transcript, no prompt parsing ---
const sPms = sid()
run({ hook_event_name: 'SessionStart', session_id: sPms, cwd: work, model: 'claude-opus-5' })
const r21 = run({ hook_event_name: 'PostModelSwitch', session_id: sPms, cwd: work, from_model: 'claude-opus-5', to_model: 'claude-fable-5', source: 'command' })
check('PostModelSwitch injects the new profile from to_model', /is your memory/.test(r21.ctx) && /no longer applies/.test(r21.ctx) && JSON.parse(r21.out).hookSpecificOutput.hookEventName === 'PostModelSwitch', r21.out.slice(0, 200))
const r22 = run({ hook_event_name: 'PreToolUse', session_id: sPms, cwd: work, transcript_path: transcript([assistant('claude-fable-5')]) })
check('later events stay silent after PostModelSwitch', r22.out === '')

// --- display-name switch record: "Set model to `Sonnet 5.5` and saved as your default…" ---
const t23 = transcript([assistant('claude-opus-5'), switched('`Sonnet 5.5` and saved as your default for new sessions')])
const r23 = run({ hook_event_name: 'PreToolUse', session_id: sid(), cwd: work, transcript_path: t23 })
check('display-name switch record resolves to the family profile', /scope boundaries/.test(r23.ctx), r23.out.slice(0, 200))

// --- a tool call inside a subagent must not receive the main-model profile ---
const r24 = run({ hook_event_name: 'PreToolUse', session_id: sid(), cwd: work, agent_id: 'agent-1', transcript_path: t1 })
check('events inside a subagent get no main-model profile', r24.out === '' && r24.code === 0)

// --- a profile that appears AFTER the first silent look is still delivered (live finding) ---
// a model no machine has a profile for: the lookup also reads ~/.claude/gwork-profiles
const lateDir = join(work, 'late-profiles'); mkdirSync(lateDir, { recursive: true })
const sLate = sid()
const r25 = run({ hook_event_name: 'SessionStart', session_id: sLate, cwd: work, model: 'claude-zeta-9' }, { GWORK_PROFILES: lateDir })
writeFileSync(join(lateDir, 'zeta-9.md'), 'LATE PROFILE RULE')
const r26 = run({ hook_event_name: 'PreToolUse', session_id: sLate, cwd: work, transcript_path: transcript([assistant('claude-zeta-9')]) }, { GWORK_PROFILES: lateDir })
check('profile added after a silent first look is delivered', r25.out === '' && /LATE PROFILE RULE/.test(r26.ctx) && !/no longer applies/.test(r26.ctx), r26.out.slice(0, 200))
const r27 = run({ hook_event_name: 'PreToolUse', session_id: sLate, cwd: work, transcript_path: transcript([assistant('claude-zeta-9')]) }, { GWORK_PROFILES: lateDir })
check('…and then only once', r27.out === '')

// --- one switch, one block: a stale transcript must not undo what PostModelSwitch said (seen live) ---
const stale = transcript([assistant('claude-fable-5')])   // the tail still names the OLD model
const fresh = transcript([assistant('claude-fable-5'), assistant('claude-sonnet-5')])
for (const order of ['switch-first', 'prompt-first']) {
  const s = sid()
  run({ hook_event_name: 'PreToolUse', session_id: s, cwd: work, transcript_path: stale })   // session starts on fable
  const sw = () => run({ hook_event_name: 'PostModelSwitch', session_id: s, cwd: work, from_model: 'claude-fable-5', to_model: 'claude-sonnet-5', source: 'sdk' })
  const up = () => run({ hook_event_name: 'UserPromptSubmit', session_id: s, cwd: work, prompt: 'hello', transcript_path: stale })
  const [a, b] = order === 'switch-first' ? [sw(), up()] : [up(), sw()]
  const tool = run({ hook_event_name: 'PreToolUse', session_id: s, cwd: work, transcript_path: fresh })
  const stop = run({ hook_event_name: 'Stop', session_id: s, cwd: work, transcript_path: fresh })
  const blocks = [a, b, tool, stop].filter(r => r.out)
  check(`one switch, one block (${order})`, blocks.length === 1 && /scope boundaries/.test(blocks[0].ctx) && /fable-5 no longer applies/.test(blocks[0].ctx) && [a, b, tool, stop].every(r => !/Running on claude-fable-5\b/.test(r.ctx)), blocks.map(r => r.ctx.slice(0, 60)).join(' || '))
  // …and a second switch, back again, is announced once too
  const back = [
    run({ hook_event_name: 'PostModelSwitch', session_id: s, cwd: work, from_model: 'claude-sonnet-5', to_model: 'claude-fable-5', source: 'sdk' }),
    run({ hook_event_name: 'UserPromptSubmit', session_id: s, cwd: work, prompt: 'hello', transcript_path: fresh }),   // tail now names sonnet: stale again
    run({ hook_event_name: 'PreToolUse', session_id: s, cwd: work, transcript_path: transcript([assistant('claude-sonnet-5'), assistant('claude-fable-5')]) }),
  ].filter(r => r.out)
  check(`switching back is one block too (${order})`, back.length === 1 && /is your memory/.test(back[0].ctx) && /sonnet-5 no longer applies/.test(back[0].ctx), back.map(r => r.ctx.slice(0, 60)).join(' || '))
}
// without PostModelSwitch (an older harness) the transcript is still believed
const sOld = sid()
run({ hook_event_name: 'PreToolUse', session_id: sOld, cwd: work, transcript_path: stale })
const rOld = run({ hook_event_name: 'PreToolUse', session_id: sOld, cwd: work, transcript_path: fresh })
check('no PostModelSwitch ever seen: the transcript still announces a change', /scope boundaries/.test(rOld.ctx), rOld.out.slice(0, 120))
// after /clear the authority is forgotten along with everything else
const sClr = sid()
run({ hook_event_name: 'PostModelSwitch', session_id: sClr, cwd: work, to_model: 'claude-sonnet-5' })
run({ hook_event_name: 'SessionStart', session_id: sClr, cwd: work, source: 'clear' })
const rClr = run({ hook_event_name: 'PreToolUse', session_id: sClr, cwd: work, transcript_path: stale })
check('after /clear the transcript is believed again', /is your memory/.test(rClr.ctx), rClr.out.slice(0, 120))

check('no stderr noise in any case', [r1, r2, r3, r4, r5, r6, r7, r9, r10, r11, r13, r14, r15, r16, r17, r18, r19, r20, r21, r22, r23, r24, r25, r26, r27].every(r => !r.err))

rmSync(work, { recursive: true, force: true })
console.log(fail ? `\n${fail} FAILED` : '\nall model-profile cases pass')
process.exit(fail ? 1 : 0)
