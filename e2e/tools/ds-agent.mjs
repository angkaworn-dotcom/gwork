#!/usr/bin/env node
// Minimal tool-use agent loop for DeepSeek, driving one e2e sandbox.
//   DEEPSEEK_API_KEY=... node ds-agent.mjs <repoPath> <promptFile>
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const [repo, promptFile] = process.argv.slice(2)
const KEY = (process.env.DEEPSEEK_API_KEY ?? readFileSync(resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'ds.key'), 'utf8')).trim()
if (!KEY || !repo || !promptFile) { console.error('usage: node ds-agent.mjs <repo> <promptFile> (key in ds.key or DEEPSEEK_API_KEY)'); process.exit(1) }
const prompt = readFileSync(promptFile, 'utf8').replaceAll('{REPO}', repo)

const tools = [
  { type: 'function', function: { name: 'exec', description: 'Run a shell command (cwd is the repo root). Returns stdout+stderr; failures are returned as ERROR text.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a text file (output truncated if very large). Path relative to the repo root. Optional offset (1-based start line) and limit (line count) to read a chunk.', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Write a text file (overwrites; creates parent dirs). Path relative to the repo root.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
]

function runTool(name, args) {
  try {
    if (name === 'exec') {
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
