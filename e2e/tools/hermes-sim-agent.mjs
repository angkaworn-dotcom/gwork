#!/usr/bin/env node
// Hermes-simulation agent loop for DeepSeek (S10) — ds-agent.mjs fork that reproduces
// hermes-agent's tool contract, for testing the gwork Hermes adapter end to end:
//   * write_file tool takes {path, content} (same field names as Hermes)
//   * before executing write_file/patch, hermes/hooks/tasklog-gotcha-hermes.mjs runs
//     exactly like agent/shell_hooks.py would (JSON payload on stdin, block JSON on stdout)
//   * a block returns {"error": "<message>"} as the tool result — the exact string
//     hermes-agent's model_tools.py returns to the model on a plugin block
// Logs HOOK-BLOCK / WRITE-OK lines to <repo>/hermes-sim.log for deterministic scoring.
//   DEEPSEEK_API_KEY=... node hermes-sim-agent.mjs <repoPath> <promptFile>
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const [repo, promptFile] = process.argv.slice(2)
let KEY = process.env.DEEPSEEK_API_KEY
if (!KEY) { try { KEY = readFileSync(resolve(HERE, 'ds.key'), 'utf8') } catch { /* handled below */ } }
KEY = KEY?.trim()
if (!KEY || !repo || !promptFile) { console.error('usage: node hermes-sim-agent.mjs <repo> <promptFile> (key in ds.key next to this script, or DEEPSEEK_API_KEY)'); process.exit(1) }
const prompt = readFileSync(promptFile, 'utf8').replaceAll('{REPO}', repo)

const ADAPTER = resolve(HERE, '../../hermes/hooks/tasklog-gotcha-hermes.mjs')
// unique per run — the hook's block-once state is keyed by session_id in tmpdir and
// would otherwise leak across rebuilt sandboxes with the same dir name
const SESSION = `sim-${basename(repo)}-${process.pid}-${Date.now()}`
const LOG = resolve(repo, 'hermes-sim.log')
const log = (line) => appendFileSync(LOG, line + '\n')

// -- the Hermes pre_tool_call shell-hook bridge, faithfully reproduced --------
function preToolCallHook(toolName, args) {
  if (!/^(write_file|patch)$/.test(toolName)) return null // matcher
  const payload = JSON.stringify({
    hook_event_name: 'pre_tool_call', tool_name: toolName, tool_input: args,
    session_id: SESSION, cwd: repo, extra: { task_id: '', tool_call_id: '' },
  })
  const r = spawnSync('node', [ADAPTER], { input: payload, encoding: 'utf8', timeout: 15000 })
  try {
    const out = JSON.parse(r.stdout)
    const blocked = out.action === 'block' || out.decision === 'block'
    const message = out.message ?? out.reason
    if (blocked && message) return message
  } catch { /* empty/non-JSON stdout = no-op, like shell_hooks.py */ }
  return null
}

const tools = [
  { type: 'function', function: { name: 'terminal', description: 'Run a shell command (cwd is the repo root). Returns stdout+stderr; failures are returned as ERROR text.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a text file. Path relative to the repo root. Optional offset (1-based start line) and limit (line count).', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Write a text file (overwrites; creates parent dirs). Path relative to the repo root.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
]

function runTool(name, args) {
  const blockMsg = preToolCallHook(name, args)
  if (blockMsg) {
    log(`HOOK-BLOCK ${name} ${args.path ?? ''}`)
    return JSON.stringify({ error: blockMsg })
  }
  try {
    if (name === 'terminal') {
      const out = execSync(args.command, { cwd: repo, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] })
      return out?.trim() ? out : '(no output, exit 0)'
    }
    if (name === 'read_file') {
      const text = readFileSync(resolve(repo, args.path), 'utf8')
      if (!args.offset && !args.limit) return text
      const lines = text.split('\n')
      const start = Math.max(1, args.offset ?? 1) - 1
      return lines.slice(start, args.limit ? start + args.limit : undefined).join('\n')
    }
    if (name === 'write_file') {
      const p = resolve(repo, args.path)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, args.content)
      log(`WRITE-OK ${args.path}`)
      return 'written'
    }
    return 'ERROR: unknown tool ' + name
  } catch (e) {
    return 'ERROR: ' + [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').slice(0, 4000)
  }
}

const messages = [{ role: 'user', content: prompt }]
let finished = false
for (let turn = 0; turn < 60 && !finished; turn++) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: process.env.DS_MODEL ?? 'deepseek-v4-flash', messages, tools, temperature: 0 }),
  })
  if (!res.ok) { console.error('API error', res.status, (await res.text()).slice(0, 500)); process.exit(1) }
  const msg = (await res.json()).choices[0].message
  messages.push(msg)
  if (!msg.tool_calls?.length) {
    console.log('=== FINAL REPORT ===\n' + (msg.content ?? '(empty)'))
    finished = true
    break
  }
  for (const tc of msg.tool_calls) {
    let args = {}
    try { args = JSON.parse(tc.function.arguments) } catch { /* pass empty */ }
    console.log(`[${turn}] ${tc.function.name} ${(args.command ?? args.path ?? '').slice(0, 140)}`)
    messages.push({ role: 'tool', tool_call_id: tc.id, content: String(runTool(tc.function.name, args)).slice(0, 48000) })
  }
}
if (!finished) console.error('hit 60-turn cap without finishing')
