Rules live in [CLAUDE.md](CLAUDE.md). Do not edit either file automatically.

<!--
Why this near-empty file exists.

`next dev` appends a `nextjs-agent-rules` block to an agent-instructions file on
every start, unconditionally — there is no env var and no config flag
(`node_modules/next/dist/server/lib/generate-agent-files.js`, `writeAgentFiles`).
Given the choice it writes to AGENTS.md and SKIPS CLAUDE.md. This file is here to
be that target, so the rules every session in this repo is held to are not
rewritten by a tool — and so the block's own "committing it with your work keeps
the tree clean" line never gets taken up on CLAUDE.md's behalf.

Two things keep that working:

  * do not delete this file; and
  * never commit that block into CLAUDE.md. The generator picks AGENTS.md only
    while CLAUDE.md does not already host the block — once it does, it goes
    straight back to writing there.

Expect this file to come back dirty after `pnpm dev`. That is the mechanism
doing its job — revert it. Committing the block would adopt Next.js's own agent
instructions into this repo, and Tori's rule (2026-09-05) is that rules a tool
wrote get added deliberately, by a person who has read them, or not at all.
-->
