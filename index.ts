/**
 * Critic Guy — trigger by user typing "critic", inject critic capability
 *
 * Hook: before_agent_start
 *   - Detects if user's prompt contains "critic" (word boundary)
 *   - Injects critic instructions ONCE per session (module-level flag)
 *   - Resets flag on session_shutdown so works across sessions
 *   - Skips if system prompt is too long (length protection)
 *   - No context overhead when critic isn't requested
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Session-level state: inject only once so LLM learns the pattern
let criticInjected = false;

// Max system prompt length before we skip injection (≈ 50K chars → ~12-15K tokens)
const MAX_SYSTEM_PROMPT_CHARS = 50_000;

const CRITIC_INSTRUCTIONS = `

## Capability: Critic Guy (subagent review)

You can spawn an independent critic subagent for a second opinion.
It runs in a clean context with read-only tools (read, bash).
Use the **same model** as this session so API keys work.

### How

\`\`\`bash
# Run critic, save JSON output to file (avoids bash truncation)
pi -p --mode json --model <current-model> --tools read,bash \\
  --append-system-prompt <(cat <<'PROMPT'
You are Critic Guy — an independent reviewer.
Analyze the content and give your honest assessment.
Decide what matters most. Be direct and constructive.
Support your points with specifics.
PROMPT
) \\
  "Task: <what you want critiqued>" > /tmp/critic-output.json 2>/dev/null

# Extract the final critique text
python3 -c "
import json
with open('/tmp/critic-output.json') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            e = json.loads(line)
            if e.get('type') == 'message_end' and e.get('message',{}).get('role') == 'assistant':
                for c in e['message'].get('content',[]):
                    if c['type'] == 'text':
                        print(c['text'])
        except: pass
"
\`\`\`

### Tips
- Use the same model as this session (inherits API key config)
- Multiple passes: run several in parallel, write to different temp files
- The file trick avoids bash output getting truncated at 50KB
`;

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		// Word boundary: only match standalone "critic", not "critical"/"criticism"
		if (!/\bcritic\b/i.test(event.prompt)) {
			return undefined;
		}

		// Already injected this session — LLM remembers the pattern
		if (criticInjected) {
			return undefined;
		}

		// Length protection: skip if system prompt is too large
		if (event.systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
			return undefined;
		}

		criticInjected = true;
		return {
			systemPrompt: event.systemPrompt + CRITIC_INSTRUCTIONS,
		};
	});

	// Reset flag on session end so fresh sessions get fresh instructions
	pi.on("session_shutdown", () => {
		criticInjected = false;
	});
}
