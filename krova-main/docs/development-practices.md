# Development Practices

> On-demand detail extracted from CLAUDE.md. CLAUDE.md keeps only a short summary + a pointer to this file; the full reference lives here.

Behavioral guidelines to reduce common LLM coding mistakes. These bias toward caution over speed — for trivial tasks, use judgment.

### Quality Over Speed — Always

Delay is acceptable. Sloppy work is not. The user has explicitly stated they prefer slow, thorough, well-researched output over fast output that needs repeated correction. Treat every task as if a senior engineer will review the diff line by line.

Concretely, before declaring a task done:

- **Broaden the search.** After fixing or changing one instance of a pattern, grep the rest of the codebase for the same pattern unprompted. Never wait to be told "check the others too." Examples: raw `sql` template literals, deprecated APIs, wrong import paths, missing audit logs.
- **Read the changelog.** After any dependency upgrade — even a patch bump — fetch the release notes and audit the codebase against listed changes. Report findings before saying "done."
- **Extract before inlining.** Any non-trivial logic going into a hook, config file, or shell-glue belongs in a named script under `scripts/` with a matching `pnpm` command. Don't inline ten lines of bash into `.husky/*`. If it deserves to exist, it deserves a name.
- **Default to warn, not auto-fix.** When unsure whether to take a destructive or mutating action vs. surface a warning, pick the warning. Auto-fixes hide the user's intent from them.
- **Pick the right surface.** Pre-commit vs. pre-push, server action vs. API route, sheet vs. dialog — these are real decisions. Don't guess; ask one tight question if unclear.
- **Verify, then claim.** Run typecheck, lint, and any relevant smoke test before saying it works. "Should work" is not acceptable.

When in doubt, take the slower path.

### Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Research → Brainstorm → Think → Ask → Implement

Every non-trivial change follows this order. Do not skip steps.

1. **Research.** Read the relevant project code. Fetch the latest official docs for any external API/package/SDK involved. Do not rely on training data — versions, API shapes, and patterns drift.
2. **Brainstorm.** Consider multiple implementation paths. Surface trade-offs out loud. Name the one you'd recommend and why.
3. **Think.** Check your plan against existing conventions in this file and the established codebase. If it's a big refactor or surface change, say so.
4. **Ask.** If there's any ambiguity about what the user wants, ask a tight, specific question. Don't pick silently. Don't implement and then ask.
5. **Implement.** Only after the user confirms the plan. End-to-end, tested. If you can't ship end-to-end in this turn, state the remaining steps explicitly — no silent scaffolding.

### Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that _your_ changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### Goal-Driven Execution

Define success criteria. Loop until verified.

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan with per-step verification checks. Strong success criteria let you loop independently; weak criteria ("make it work") require constant clarification.

### No Fake Features, No Scaffolding Theater

- If you create a route, it must have a real handler doing real work.
- If you create a UI page, it must render against a real backend.
- If you create a DB table, it must have at least one service that reads and at least one path that writes.
- Never stand up a "skeleton" and call it done.
- Never ship "for the future" code — wait until the future is now.
- If you cannot implement something real in the turn you have, say so and do not ship the surface at all.

### Third-Party Integrations — Research BEFORE Writing Code

**This is not optional and it is not a one-time step.** Training data is stale the moment it is written; third-party APIs, SDKs, webhook event names, enum values, auth flows, and rate limits drift constantly. ANY time you touch code that talks to a third party — writing it, modifying it, reviewing it, or AUDITING it — you MUST verify against the vendor's CURRENT official documentation, not your memory. If you find yourself about to state how a third-party API behaves from memory, stop and go fetch the docs first.

Whenever a plan, implementation, modification, review, or audit depends on a third-party service, API, SDK, or package, do real research before writing or claiming anything:

1. **Fetch the vendor's current docs** with `WebFetch` (or `WebSearch` if you don't know the canonical URL). Do not rely on training-data memory for API shapes, endpoint names, parameter names, enum/event-name values, auth flows, or rate limits. Prefer the docs for the EXACT version installed (read `node_modules/<pkg>` types / shipped docs as ground truth — they match production), then cross-check the live docs site.
2. **Pin the version** you're implementing/verifying against in comments and the session summary, and confirm it is the installed version (`package.json` + lockfile). No version = no implementation and no "it's correct" claim.
3. **Verify package versions exist on the registry** before picking a range, and check whether a newer release exists: `npm view <pkg> version` / `npm view <pkg> versions` or the vendor's release page. No invented versions. After ANY dependency bump — even a patch — fetch the release notes and audit the codebase against the listed changes before saying "done" (this is the "Read the changelog" discipline).
4. **Re-verify on every touch, not just first write.** When you modify or audit an existing integration, re-confirm the API still matches current docs — a webhook event may have been renamed, a parameter deprecated, an enum value added. Do not assume the original author's (or your own earlier) research is still valid.
5. **Call out breaking changes** you find during research, even if they don't affect the current task.
6. If you skip any of this because the task is "obviously" a known API, say so out loud and flag the assumption — don't skip silently.

### Follow External Specs

When the user points at a spec (Stripe, Shopify Admin API, BetterAuth, etc.):

- Implement THAT spec, not a look-alike of your own design.
- Fetch the latest docs first. Cite the URL/version in the commit or PR body.
- If you can't follow the spec fully, say which parts are out — don't fudge it.

### Surgical Purges

When the user tells you to remove something, remove it completely:

- Source files, generated files, DB tables, routes, UI pages, imports, sidebar nav, references in docs, references in system prompts.
- Run a grep pass at the end to confirm zero residual references.
- Run `pnpm typecheck` and `pnpm lint` and confirm green before saying "done."

### Do Not Promise Timelines or Outcomes

Do not say "24/7," "fully tested," "production ready," "battle-tested" unless it's literally true. Describe what you did, what works, what doesn't, what's next.

### Phase Handoffs — Always Ask, Never Auto-Advance

When a multi-phase plan is in flight, do not start the next phase just because the current one is green.

- End each phase with a short status and a concrete question: _"Phase N is done. Do you want to proceed to Phase N+1, or review first?"_
- Wait for explicit go/no-go before writing a single line of the next phase.

### Reply Style — Short, Conversational

The user reads short replies, not walls of text. Default to a few lines.

- One question at a time. Ten short turns beat one long message.
- No headers/tables/bullet-heavy walls unless genuinely needed.
- Don't re-state the plan before every action. State what you're doing once, do it, report the outcome briefly.
- When asking for clarification, ask **one** specific thing.
- End-of-turn summary: one or two sentences. What changed. What's next.
- Code references use `path:line` so the user can jump.

### User-Facing Naming Is a Product Decision

Never pick a user-facing name because the underlying table, column, file, or variable is already called that. DB schema and code identifiers are internal details. User naming is a product decision.

When a rename would better serve the user but would cost an internal migration, propose the rename. Do not silently adopt a worse user-facing label to dodge a migration.

### Reuse Existing Primitives — Never Invent a Parallel One

Before implementing any UI component, layout, screen, or interaction:

- Search the codebase for similar existing implementations FIRST.
- Study at least 2–3 reference implementations.
- Reuse existing components, hooks, design tokens, and layout primitives rather than creating parallel ones.
- Match spacing, typography, color tokens, breakpoints, and interaction behaviors already established.

When no similar pattern exists: say so explicitly, propose the new pattern, get confirmation before inventing a new convention.

