# Agent hooks fail open and never answer "allow"

A hook that guards edits looks like it should fail closed. Ours do the opposite: on a crash, a timeout, an unreadable config or a missing sentinel, the edit proceeds. The hooks run on every edit of every session on the machine, in repos that have nothing to do with gwork; a hook that blocks when it breaks would stop all work for a fault in the kit. The gates that must hold are the git hooks, which fail loud.

The same hooks never return `permissionDecision: "allow"`. It reads like a neutral pass, but the harness treats it as approval and skips the user's permission prompt. With nothing to say a hook prints nothing; with context to add it returns `additionalContext` and no decision.

## Consequences

- The edit-time forbidden check and the sentinel deny are skipped if the hook itself fails. They narrow a hole; check F at commit and push is what closes it.
- A broken `gwork.json` cannot be allowed to pass silently under this rule, so the hooks say it once per session.
