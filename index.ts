/**
 * Critic Guy — trigger by user typing "critic", inject critic capability
 *
 * Hook: before_agent_start
 *   - Detects if user's prompt contains "critic" (word boundary)
 *   - Parses optional model specification: "critic using claude" / "critic model=gpt"
 *   - Matches model name against available models from registry
 *   - Injects critic instructions on every turn that mentions "critic"
 *     (cheap, bounded; dedup marker prevents double-injection within a turn)
 *   - Dynamically injects the resolved model ID so the LLM knows what to use
 *   - On oversize system prompt, injects a short visible note instead of silently
 *     doing nothing, so the LLM can explain why critic didn't activate
 *   - No context overhead when critic isn't requested
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Max system prompt length before we skip injection (≈ 50K chars → ~12-15K tokens)
const MAX_SYSTEM_PROMPT_CHARS = 50_000;

// Slack allowed for the injected instructions on top of MAX before we bail out.
const INJECTION_HEADROOM = 5_000;

// Last-resort model when neither a user-specified, session, nor registry model is
// available. Dated id that will eventually age out — it only fires when ctx.model
// is undefined AND the registry is empty AND the user named no model, which is rare.
const FALLBACK_MODEL = "claude-sonnet-4-20250514";

// Read-only tool set: pi's own "read-only" tools (read, grep, find, ls).
// Deliberately excludes bash/edit/write so the critic genuinely cannot mutate
// the workspace or run arbitrary commands.
const CRITIC_TOOLS = "read,grep,find,ls";

// Single source of truth for the capability heading — also used as the dedup marker.
const CRITIC_MARKER = "## Capability: Critic Guy (subagent review)";

// Shared reviewer persona. The secrets prohibition matters: read/grep/find are not
// confined to the workspace and the child inherits env vars, so a prompt-injected
// critic could otherwise read credentials and feed them back into the main context.
const CRITIC_PERSONA =
	"You are Critic Guy — an independent reviewer. Analyze the content and give your honest assessment. Decide what matters most. Be direct and constructive. Support your points with specifics. Only review the files/content named in the task; never read credentials, secrets, or dotfiles (.env, ~/.ssh, ~/.aws, ~/.pi/agent/auth.json) or anything outside the review target.";

const CRITIC_INSTRUCTIONS = (modelId: string) => `

${CRITIC_MARKER}

When the user says "critic", you can spawn one or more independent critic
subagents for a second opinion. Each runs in a fresh, read-only pi session
(tools: ${CRITIC_TOOLS}) — it cannot edit files, write files, or run shell commands.

**You decide how to run the review** — the user doesn't need to specify:
- **What to review**: pick the most valuable target from the current conversation.
- **How to split it**: one critic for a focused review, or several in parallel
  (each on a different angle) when the scope is large. Your judgment.

Spawn a critic with this invocation. The flags are the hard boundary — keep them
as-is: \`--offline -ne\` stops the child hanging on startup, and the read-only
\`--tools\` keep it from mutating anything or running commands.

\`\`\`bash
pi -p --offline -ne --no-session -nc --model "${modelId}" --tools ${CRITIC_TOOLS} \\
  --append-system-prompt "${CRITIC_PERSONA}" \\
  "Task: <what to review — name concrete file paths and tell the critic to read them first>"
\`\`\`

Always give the critic concrete file paths and tell it to read them before judging;
this stops it inventing features or tests that aren't in the code. Run multiple in
parallel however you see fit, then present the critique(s) to the user.

Model: \`${modelId}\` (resolved by the extension — use as-is).
`;

// Shown (instead of silent no-op) when the system prompt is too large to inject into.
const SKIP_NOTE =
	"\n\n> Note: Critic Guy was triggered but skipped this turn because the system prompt is already very large. Tell the user they can retry in a fresh/smaller context.\n";

/**
 * Match a user-provided model query against available models.
 * Priority: exact id > exact name > partial match on id/name.
 * Returns null when nothing matches — the caller decides how to fall back so it
 * can tell the user their requested model wasn't found (no silent substitution).
 */
export function matchModel(
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
 * "critic using 通义" → "通义"
 * "critic" → ""
 *
 * The unicode-aware charset (\p{L}\p{N}._-) supports non-ASCII model names while
 * still excluding shell metacharacters (space, quotes, $, backtick, ;, |), so the
 * captured value is safe to surface in the injected instructions.
 */
export function parseModelQuery(prompt: string): string {
	// model=<name> or model: <name> (handle optional quotes)
	const modelFlag = prompt.match(/\bmodel[=:]\s*["']?([\p{L}\p{N}._-]+)["']?/iu);
	if (modelFlag) return modelFlag[1];

	// "using <name>" after "critic". No "with <name>" branch: "with" appears too often
	// in natural language ("critic review auth with the team") and mis-captures filler.
	const usingMatch = prompt.match(/\bcritic\b.*?\busing\s+([\p{L}][\p{L}\p{N}._-]*)/iu);
	if (usingMatch) return usingMatch[1];

	return "";
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		try {
			// Safe guard: prompt may be undefined
			if (!event.prompt) return undefined;

			// Word boundary: only match standalone "critic", not "critical"/"criticism"
			if (!/\bcritic\b/i.test(event.prompt)) {
				return undefined;
			}

			const systemPrompt = event.systemPrompt ?? "";

			// Length protection: if the prompt is already huge, don't inject — but say so
			// instead of silently doing nothing, so the user isn't left wondering.
			if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
				return { systemPrompt: systemPrompt + SKIP_NOTE };
			}

			// Dedup: skip if already injected (e.g. another extension chained us this turn)
			if (systemPrompt.includes(CRITIC_MARKER)) {
				return undefined;
			}

			// Resolve model: user-specified > current session > first available > fallback
			const currentModelId = ctx.model?.id;
			const availableModels = ctx.modelRegistry?.getAvailable() ?? [];
			const modelQuery = parseModelQuery(event.prompt);
			const matchedModelId = modelQuery ? matchModel(modelQuery, availableModels) : null;
			const modelId =
				matchedModelId || currentModelId || availableModels[0]?.id || FALLBACK_MODEL;

			// If the user named a model but we couldn't match it, don't substitute
			// silently — tell the LLM so it can flag the fallback to the user.
			// Cap the echoed query length as a belt-and-suspenders against prompt injection.
			const unmatchedNote =
				modelQuery && !matchedModelId
					? `\n> Note: the requested model "${modelQuery.slice(0, 64)}" did not match any available model; falling back to \`${modelId}\`. Mention this to the user.\n`
					: "";

			const newSystemPrompt = systemPrompt + CRITIC_INSTRUCTIONS(modelId) + unmatchedNote;

			// Post-injection length check
			if (newSystemPrompt.length > MAX_SYSTEM_PROMPT_CHARS + INJECTION_HEADROOM) {
				return { systemPrompt: systemPrompt + SKIP_NOTE };
			}

			return { systemPrompt: newSystemPrompt };
		} catch (err) {
			console.warn("[Critic Guy] injection failed:", err);
			return undefined;
		}
	});
}
