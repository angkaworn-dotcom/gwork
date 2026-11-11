#!/usr/bin/env node
/**
 * model-profile.mjs — injects the gwork rules that differ per model, and only those.
 *
 * Why this exists: the harness already tunes verbosity, scope, self-verification and
 * progress reporting per model — repeating that in CLAUDE.md causes over-verification.
 * What it cannot know is gwork itself (task-log, the hook gates, delegation rules), and
 * those differ by model: Opus 5 must not spawn verifier subagents, Fable 5 should
 * delegate freely and treat task-log as its memory, small models still need the
 * self-review scaffolding that large models are hurt by. One file per model, injected
 * only for the model actually running.
 *
 * Events (each is one line in settings.json):
 *   PostModelSwitch  — the documented channel for a mid-session switch (Claude Code 2.1.251+):
 *                      carries `to_model`, delivered with the next request. Where it exists it
 *                      makes the transcript-reading fallbacks below redundant; they stay for older builds.
 *   SessionStart     — `model` field is optional and often absent → falls back to the transcript
 *   UserPromptSubmit — authoritative: reads the transcript tail every prompt, injects ONLY when
 *                      the model changed since the last injection (mid-session /model switches
 *                      do not re-fire SessionStart, so this is the channel that actually catches them)
 *   SubagentStart    — subagents get the small-model scaffolding + the never-commit rule
 *
 * Fail-open everywhere: a missing profile, an unreadable transcript or a broken config
 * must never block a prompt. Unknown model = inject nothing (never guess a profile —
 * pushing small-model scaffolding into a new large model is worse than staying silent).
 * A minor revision is not an unknown model: fable-5-2 with no fable-5-2.md reads fable-5.md.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync, rmSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { tmpdir, homedir } from 'node:os'

// Four chances to catch a model change, because no single one covers every path (L-005):
// UserPromptSubmit reads the prompt text (a typed /model never reaches the transcript in time),
// PreToolUse catches it at the first tool call (by then the transcript has it), Stop closes the
// remaining gap — a turn with no tool calls at all. Context returned on Stop continues the turn
// (one extra model step, once per switch); it does not wait for the next prompt.
const EVENTS = new Set(['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'PostModelSwitch'])

let input = ''
try { input = readFileSync(0, 'utf8').replace(/^﻿/, '') } catch { process.exit(0) } // strip BOM some shells prepend when piping
let data = {}
try { data = JSON.parse(input) } catch { process.exit(0) }

const event = data?.hook_event_name ?? ''
if (!EVENTS.has(event)) process.exit(0)

// /clear and compaction wipe the context but not our state file — without this reset the
// profile would never be re-injected even though the model no longer sees it. SessionStart
// re-fires on both and carries `source`, so that's where the state is dropped.
const stateDirEarly = join(tmpdir(), 'gwork-model-profile')
if (event === 'SessionStart' && ['clear', 'compact'].includes(data?.source)) {
  try { rmSync(join(stateDirEarly, `${(typeof data?.session_id === 'string' && data.session_id ? data.session_id : 'nosession').replace(/[^\w.-]/g, '_').slice(0, 120)}.json`), { force: true }) } catch { /* fail-open */ }
}

const emit = (text) => {
  // One shape for every event: additionalContext at the top level is ignored without an error
  // (it used to be emitted that way for SessionStart/SubagentStart, so nothing was delivered).
  if (text) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }))
  process.exit(0)
}

// --- repo root: the directory holding gwork.json or task-log/INDEX.md (walk up from cwd) ---
const cwd = typeof data?.cwd === 'string' && data.cwd ? data.cwd : process.cwd()
const sid = (typeof data?.session_id === 'string' && data.session_id ? data.session_id : 'nosession').replace(/[^\w.-]/g, '_').slice(0, 120) // becomes a file name
let root = cwd
for (let i = 0, dir = cwd; i < 6; i++) {
  if (existsSync(join(dir, 'gwork.json')) || existsSync(join(dir, 'task-log', 'INDEX.md'))) { root = dir; break }
  const up = dirname(dir); if (up === dir) break; dir = up
}

let cfg = {}
try { cfg = JSON.parse(readFileSync(join(root, 'gwork.json'), 'utf8').replace(/^\uFEFF/, '')) } catch { /* no config = defaults */ }
if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {}
if (cfg.profiles === false) process.exit(0) // per-repo opt-out

// --- where profiles live: repo override first, then the machine-level copy ---
const profileDirs = [
  process.env.GWORK_PROFILES,
  typeof cfg.profilesDir === 'string' && cfg.profilesDir ? (isAbsolute(cfg.profilesDir) ? cfg.profilesDir : join(root, cfg.profilesDir)) : null,
  join(root, '.gwork', 'profiles'),
  join(homedir(), '.claude', 'gwork-profiles'),
].filter(Boolean)

const readProfile = (name) => {
  for (const dir of profileDirs) {
    const p = join(dir, `${name}.md`)
    try { if (existsSync(p)) return readFileSync(p, 'utf8').replace(/^﻿/, '').trim() } catch { /* try next */ }
  }
  return null
}

// --- subagents: always the small-model scaffolding, never a main-model profile ---
if (event === 'SubagentStart') emit(readProfile('subagent')?.slice(0, 9500))
// Any other event fired INSIDE a subagent carries agent_id — the main-model profile is not for it.
if (data?.agent_id) process.exit(0)

// --- which model is running? ---
// `model` on SessionStart is optional (and absent on a plain startup), so the transcript is
// the real source: every assistant message carries `model`, and a mid-session `/model` switch
// is recorded as a user-side local-command line BEFORE the next assistant turn — reading both
// and taking whichever is newer means a switch is picked up on the very next prompt, not one turn late.
// Observed forms (the text is undocumented and the transcript format is declared unstable, so
// this is a best-effort fallback): `claude-x` in backticks, the bare id on older builds, and a
// display name with a trailer — "Set model to `Sonnet 5.5` and saved as your default for new sessions".
// `[1m]` = context-window suffix.
const SWITCH_RE = /^<local-command-stdout>Set model to `?([\w .-]+?)(?:\[\w+\])?`?(?: and [^<]*)?<\/local-command-stdout>$/

const modelFromTranscript = (path) => {
  if (!path || !existsSync(path)) return null
  let fd
  try {
    const size = statSync(path).size
    const want = Math.min(size, 256 * 1024) // tail only — transcripts reach megabytes
    const buf = Buffer.alloc(want)
    fd = openSync(path, 'r')
    readSync(fd, buf, 0, want, size - want)
    const lines = buf.toString('utf8').split(/\r?\n/) // L-001: never split on '\n' alone
    if (want < size) lines.shift() // first line is a partial record
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]
      if (!l) continue
      let o
      try { o = JSON.parse(l) } catch { continue }
      if (o?.isSidechain) continue // subagent turns run their own model — not the main one
      // Parse the record, never substring-match the raw line: a transcript can contain
      // "Set model to ..." inside a tool call or its result (an agent grepping for it).
      if (o?.type === 'user' && typeof o?.message?.content === 'string') {
        const m = o.message.content.match(SWITCH_RE)
        if (m) return m[1]
      }
      if (o?.type === 'assistant' && typeof o?.message?.model === 'string') return o.message.model
    }
  } catch { /* unreadable transcript = unknown model */ } finally { if (fd !== undefined) try { closeSync(fd) } catch {} }
  return null
}

// A `/model` switch is submitted as a prompt of its own, and UserPromptSubmit fires with that
// text BEFORE any of it reaches the transcript — measured, not assumed: at hook time the newest
// transcript record is still the previous turn's assistant message, carrying the OLD model. So the
// prompt text is the only signal that exists at the moment of the switch; without reading it the
// new profile lands a full turn late, while the previous model's profile is still live in context.
const promptSwitch = event === 'UserPromptSubmit' && typeof data?.prompt === 'string'
  ? data.prompt.match(/^\s*\/model\s+(?:set\s+)?([\w.-]+)(?:\[\w+\])?\s*$/)?.[1]
  : null

const raw = (event === 'PostModelSwitch' && typeof data?.to_model === 'string' && data.to_model)
  || promptSwitch
  || (event === 'SessionStart' && typeof data?.model === 'string' && data.model)
  || modelFromTranscript(data?.transcript_path)
if (!raw) process.exit(0) // fresh session, nothing has run yet — the next prompt resolves it

// claude-haiku-4-5-20251001 → haiku-4-5 · claude-opus-5 → opus-5 · "Sonnet 5.5" → sonnet-5-5
const key = raw.replace(/\[\w+\]$/, '').trim().toLowerCase().replace(/[\s.]+/g, '-').replace(/^claude-/, '').replace(/-\d{8}$/, '')
// the key becomes a file name: anything that is not a plain model token (`../`, quotes, a 5,000-character id) is no model we know
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) process.exit(0)

// --- inject once per model, not once per prompt ---
const stateDir = join(tmpdir(), 'gwork-model-profile')
const stateFile = join(stateDir, `${sid}.json`)
let state = {}
try { state = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* fresh */ }
if (state === null || typeof state !== 'object') state = {}
// Skip only when the profile for this model was actually DELIVERED. The state used to record
// the model even when no profile file matched; a profile that became available later in the
// session (a file added, the kit updated) was then never injected — seen live: the state said
// {"model":"fable-5-2"} and the session ran its whole length with no profile.
if (state.model === key && state.injected === true) process.exit(0)

// exact id first, then the family: claude-fable-5-2 → fable-5-2.md → fable-5.md. Without the
// fallback every minor release silently switches the whole layer off until someone adds a file.
const profile = readProfile(key) ?? readProfile(key.replace(/-\d+$/, '')) // still no file → stay silent rather than guess
const previous = state.injected === true ? state.model : undefined // only a profile that was shown can be superseded
try { mkdirSync(stateDir, { recursive: true }); writeFileSync(stateFile, JSON.stringify({ model: key, injected: Boolean(profile) })) } catch { /* re-inject next prompt at worst */ }
if (!profile) process.exit(0)

// After a switch the previous model's profile is still sitting in the context window, and the two
// deliberately contradict each other (Opus 5: don't delegate verification · Fable 5: do). Saying so
// is cheaper than hoping the newer block wins.
const supersede = previous && previous !== key
  ? ` The gwork profile above for ${previous} no longer applies — this replaces it.`
  : ''

// the harness caps injected context at 10,000 characters and replaces the rest with a file pointer
const body = profile.length > 9000 ? profile.slice(0, 9000) + '\n\n[profile truncated at 9,000 characters — shorten the file]' : profile
emit(`[gwork] Running on ${raw.slice(0, 80)}.${supersede} Project rules that differ for this model:\n\n${body}`)
