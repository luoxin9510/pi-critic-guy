/**
 * Critic Guy — trigger by user typing "critic", inject critic capability
 *
 * Hook: before_agent_start
 *   - Detects if user's prompt contains "critic" (word boundary)
 *   - Parses optional model specification: "critic using claude" / "critic model=gpt"
 *   - Matches model name against available models from registry
 *   - Injects critic instructions on every turn that mentions "critic"
 *     (cheap, bounded, and survives compaction — see note below)
 *   - Dynamically injects the resolved model ID so the LLM knows what to use
 *   - Skips if the system prompt is too long (length protection)
 *   - No context overhead when critic isn't requested
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Max system prompt length before we skip injection (≈ 50K chars → ~12-15K tokens)
const MAX_SYSTEM_PROMPT_CHARS = 50_000;

// Last-resort model when neither a user-specified nor a session model is available.
// Note: this is a dated, hardcoded id and will eventually age out — it only fires
// when ctx.model is undefined AND the user didn't name a model, which is rare.
const FALLBACK_MODEL = "claude-sonnet-4-20250514";

// Read-only tool set: pi's own "read-only" tools (read, grep, find, ls).
// Deliberately excludes bash/edit/write so the critic genuinely cannot mutate
// the workspace or run arbitrary commands.
const CRITIC_TOOLS = "read,grep,find,ls";

const CRITIC_INSTRUCTIONS = (modelId: string) => `

## Capability: Critic Guy (subagent review)

You can spawn an independent critic subagent for a second opinion.
It runs in a fresh pi session with **read-only tools only** (${CRITIC_TOOLS}) —
it cannot edit files, write files, or run arbitrary shell commands.

### When the user says "critic"

1. **Look at the current conversation** — what code, design, or content have we been discussing?
2. **Pick the most valuable thing to review** — the user doesn't need to specify; you decide.
3. **Spawn a critic subagent** using the command below.
4. **Present the critique** to the user.

### How to spawn a critic

**Single review** (small scope):
\`\`\`bash
pi -p --no-session -nc --model "${modelId}" --tools ${CRITIC_TOOLS} \\
  --append-system-prompt "You are Critic Guy — an independent reviewer. Analyze the content and give your honest assessment. Decide what matters most. Be direct and constructive. Support your points with specifics." \\
  "Task: <describe what to review — include concrete file paths so the critic can read them>"
\`\`\`

**Parallel reviews** (large scope — split into focused subagents):
\`\`\`bash
# Each subagent reviews a different aspect — output is small and readable
for focus in "Correctness and edge cases" "Design and architecture" "Error handling and robustness"; do
  pi -p --no-session -nc --model "${modelId}" --tools ${CRITIC_TOOLS} \\
    --append-system-prompt "You are Critic Guy — an independent reviewer." \\
    "Task: Review <target>. Focus exclusively on: \$focus" &
done
wait
\`\`\`

### Tips
- Model: \`${modelId}\` (resolved by the extension — use as-is).
- **Large content → parallel agents**. One agent reviewing everything is slow and
  produces truncated output. Split into focused subagents instead.
- Give each critic **concrete file paths** so it can use read-only tools (${CRITIC_TOOLS}).
- Default text mode prints just the final assessment — no truncation for focused reviews.
`;

/**
 * Match a user-provided model query against available models.
 * Priority: exact id > exact name > partial match on id/name.
 * Returns null when nothing matches — the caller decides how to fall back so it
 * can tell the user their requested model wasn't found (no silent substitution).
 */
function matchModel(
	query: string,
	availableModels: Array<{ id: string; name: string }>,
): string | null {
	if (!query) return null;

	const q = query.toLowerCase().trim();

	// Exact match on id
	const exactId = availableModels.find((m) => m.id.toLowerCase() === q);
	if (exactId) return exactId.id;

	// Exact match on name
	const exactName = availableModels.find((m) => m.name.toLowerCase() === q);
	if (exactName) return exactName.id;

	// Partial match on id or name
	const partial = availableModels.find(
		(m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
	);
	if (partial) return partial.id;

	return null;
}

/**
 * Parse model specification from user prompt.
 * "critic using claude" → "claude"
 * "critic model=deepseek" → "deepseek"
 * "critic" → ""
 */
function parseModelQuery(prompt: string): string {
	// model=<name> or model: <name> (handle optional quotes)
	const modelFlag = prompt.match(/\bmodel[=:]\s*["']?([A-Za-z0-9._-]+)["']?/i);
	if (modelFlag) return modelFlag[1];

	// "using <name>" after "critic"
	const usingMatch = prompt.match(/\bcritic\b.*?\busing\s+([A-Za-z][A-Za-z0-9._-]+)/i);
	if (usingMatch) return usingMatch[1];

	// "with <name>" after "critic"
	const withMatch = prompt.match(/\bcritic\b.*?\bwith\s+([A-Za-z][A-Za-z0-9._-]+)/i);
	if (withMatch) return withMatch[1];

	return "";
}

const CRITIC_MARKER = "## Capability: Critic Guy (subagent review)";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		try {
			// Safe guard: prompt may be undefined
			if (!event.prompt) return undefined;

			// Word boundary: only match standalone "critic", not "critical"/"criticism"
			if (!/\bcritic\b/i.test(event.prompt)) {
				return undefined;
			}

			// Length protection: skip if system prompt is too large
			if (event.systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
				return undefined;
			}

			// Dedup: skip if already injected in this turn
			if (event.systemPrompt.includes(CRITIC_MARKER)) {
				return undefined;
			}

			// Resolve model: user-specified > current session > fallback
			const currentModelId = ctx.model?.id;
			const availableModels = ctx.modelRegistry?.getAvailable() ?? [];
			const modelQuery = parseModelQuery(event.prompt);
			const matchedModelId = modelQuery ? matchModel(modelQuery, availableModels) : null;
			const modelId = matchedModelId || currentModelId || FALLBACK_MODEL;

			// If the user named a model but we couldn't match it, don't substitute
			// silently — tell the LLM so it can flag the fallback to the user.
			const unmatchedNote =
				modelQuery && !matchedModelId
					? `\n> Note: the requested model "${modelQuery}" did not match any available model; falling back to \`${modelId}\`. Mention this to the user.\n`
					: "";

			const newSystemPrompt = event.systemPrompt + CRITIC_INSTRUCTIONS(modelId) + unmatchedNote;

			// Post-injection length check
			if (newSystemPrompt.length > MAX_SYSTEM_PROMPT_CHARS + 5000) {
				return undefined;
			}

			return { systemPrompt: newSystemPrompt };
		} catch (err) {
			console.warn("[Critic Guy] injection failed:", err);
			return undefined;
		}
	});
}
