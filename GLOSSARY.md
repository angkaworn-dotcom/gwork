# gwork

A discipline kit for AI coding agents: rules that can be checked are enforced by code that blocks, and only judgment calls are left to prompts.

## Language

### Layers

**Prompt layer**:
The text an agent reads and is expected to follow: the skill file, the slash commands, the per-model profiles and the CLAUDE.md template.
_Avoid_: docs, instructions, the skill (when only this layer is meant)

**Enforcement layer**:
The code that decides whether an action proceeds: the git hooks, the task-log checker, the sentinel and the edit-time hooks.
_Avoid_: the hooks (it is wider than hooks), the system

**Gate**:
A deterministic check in the enforcement layer whose failure stops an action.
_Avoid_: rule (a rule may be prompt-only), guard, validation

### Precision

**False block**:
A gate stopping an action that breaks no rule.
_Avoid_: false positive

**False pass**:
A gate letting through an action that breaks a rule.
_Avoid_: false negative, bypass (a bypass is deliberate)

**Injection**:
A piece of project history delivered into an agent's context by a hook at the moment it becomes relevant.
_Avoid_: reminder, warning

### Task-log

**Entry**:
The record of one finished task: what it solved, what it touched, what was learned.
_Avoid_: log, note, ticket

**Shard**:
One month of entries in a single file.
_Avoid_: log file, archive

**INDEX**:
The lookup table from a module to its entries, bug classes and gotcha; the only part of the task-log read before an edit.
_Avoid_: table of contents, summary

**Module**:
A named area of a repo that edits are attributed to, derived from a file's path.
_Avoid_: component, package, area

**Gotcha**:
A one-line lesson attached to a module, learned from a past entry.
_Avoid_: tip, warning, note

**Bug class**:
A gotcha that repeated or was destructive once, promoted to a numbered rule in CLAUDE.md.
_Avoid_: BC rule, known issue

**Close-out**:
Turning finished work into an entry and its INDEX links, in one commit.
_Avoid_: logging, wrap-up

### Enforcement

**Forbidden rule**:
A path and a pattern that may never occur together, lifted only by the owner.
_Avoid_: ban, lint rule

**Owner**:
The person who answers for a repo and alone may lower its protection.
_Avoid_: admin, user, maintainer

**Sentinel**:
The detector that compares the enforcement layer itself with a snapshot kept outside the repo.
_Avoid_: watchdog, guard

**Attestation**:
The owner's confirmation that the current enforcement layer is the intended one.
_Avoid_: approval, sign-off

### Distribution

**Kit**:
The source of every hook, script, command and profile.
_Avoid_: the skill (the kit is what the skill installs), package

**Copy**:
A file placed in a repo or on a machine from the kit.
_Avoid_: install, fork

**Drift**:
A copy that no longer matches the kit, either behind it or edited in place.
_Avoid_: stale, out of sync

**Profile**:
The rules that apply to one model only, injected for the model that is running.
_Avoid_: persona, preset
