# pi-critic-guy

Pi extension — spawn a second-opinion code reviewer by typing `critic` into your pi session.

## Install

```bash
# From npm
pi add npm:pi-critic-guy

# Or from local path during development
pi add /path/to/pi-critic-guy
```

## Usage

In any pi session, just type:

```
critic
critic review the auth code
critic model=deepseek-v4-flash review the error handling
critic using claude check for security issues
```

The extension injects "Critic Guy" instructions into the system prompt on turns where you mention `critic`. It resolves the model dynamically from your current session, the model registry, or the model you specify via `using <name>` or `model=<id>`.

### What it does

- Detects the word `critic` in your prompt (word boundary, won't match "critical")
- Resolves the reviewer model (your current model, or one you specify)
- Injects instructions to spawn a subagent via the `subagent` tool
- Keeps the reviewer on a short leash — read-only tools (`read`, `grep`, `find`, `ls`)

### Parallel reviews

For large codebases, the injected instructions tell the LLM to split the review into parallel subagents focusing on different aspects (correctness, design, error handling).

## How it works

The extension hooks into `before_agent_start`. When `critic` is detected:

1. It appends a "Capability: Critic Guy" section to the system prompt
2. The capability tells the LLM to spawn a `reviewer` subagent
3. The reviewer runs in an isolated context with read-only tools

The reviewer agent is defined in your pi agent directory (`~/.pi/agent/agents/reviewer.md`). It uses `claude-sonnet-4-5` and has access to `bash` for `git diff`.

## Requirements

- pi 0.79+
- `subagent` extension enabled (built-in example, see `pi subagent list`)
- `reviewer` agent defined (example at `packages/coding-agent/examples/extensions/subagent/agents/reviewer.md`)

## License

MIT
