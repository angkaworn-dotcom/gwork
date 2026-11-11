# A finding from the field enters as a note before it can become a gate

`ROADMAP.md` already holds that nothing is built without evidence from real use. When a real task-log showed that almost no INDEX row was reachable by module name, and that no repeated gotcha had ever been promoted to a bug class, the obvious move was to block the push on both. We added them to the checker as `note:` lines that never fail instead. An installed repo with hundreds of entries would have been unable to push at all, and a gate that fires on existing history teaches people to bypass it.

A note is promoted to a gate only when the owner asks for it, and only for changes made after the promotion.
