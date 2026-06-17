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

\`\`\`bash
pi -p --no-session -nc --model "${modelId}" --tools ${CRITIC_TOOLS} \\
  --append-system-prompt "You are Critic Guy — an independent reviewer. Analyze the content and give your honest assessment. Decide what matters most. Be direct and constructive. Support your points with specifics." \\
  "Task: <describe what to review — include concrete file paths so the critic can read them>"
\`\`\`

In the default (text) mode, \`pi -p\` prints **only the critic's final assessment** as
plain text on stdout — no JSON parsing needed. If the command exits non-zero, its
output will explain why (usually a missing API key or an unknown model id).

### Tips
- Model: \`${modelId}\` (resolved by the extension — use as-is).
- The critic only has read-only file access, so give it concrete paths or paste the
  content to review directly into the Task.
- Multiple passes: run several in parallel with different focuses.
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

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		// Safe guard: prompt may be undefined
		if (!event.prompt) return undefined;

		// Word boundary: only match standalone "critic", not "critical"/"criticism"
		if (!/\bcritic\b/i.test(event.prompt)) {
			return undefined;
		}

		// Length protection: skip if system prompt is too large. The systemPrompt
		// replacement is per-turn, so injecting on every critic turn keeps the
		// capability available even after a compaction drops earlier turns.
		if (event.systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
			return undefined;
		}

		// Resolve model: user-specified > current session > fallback
		const currentModelId = ctx.model?.id;
		const availableModels = ctx.modelRegistry.getAvailable();
		const modelQuery = parseModelQuery(event.prompt);
		const matchedModelId = modelQuery ? matchModel(modelQuery, availableModels) : null;
		const modelId = matchedModelId || currentModelId || FALLBACK_MODEL;

		// If the user named a model but we couldn't match it, don't substitute
		// silently — tell the LLM so it can flag the fallback to the user.
		const unmatchedNote =
			modelQuery && !matchedModelId
				? `\n> Note: the requested model "${modelQuery}" did not match any available model; falling back to \`${modelId}\`. Mention this to the user.\n`
				: "";

		return {
			systemPrompt: event.systemPrompt + CRITIC_INSTRUCTIONS(modelId) + unmatchedNote,
		};
	});
}
