# 🧐 Critic Guy

**A pi extension that trusts the model.** Type `critic` in any pi session and get a
second opinion — from an independent, read-only reviewer you spawn with a single word.

No extra tools. No agent files. No configuration. Just say `critic`.

<p align="center">
  <img src="https://raw.githubusercontent.com/luoxin9510/pi-critic-guy/main/assets/philosophy.png" alt="Critic Guy — freedom in the middle, rails at the edge" width="840">
</p>

```
critic
critic review the auth code
critic using claude check for race conditions
critic model=deepseek-v4-flash review the error handling
```

---

## Why it's different — built the pi way

pi's core bet is simple: **the model is capable — give it good context and good tools,
then get out of the way.** Critic Guy is built on exactly that bet.

It does **not** wrap reviewing in a rigid tool with fixed modes and schemas. It teaches
the model a *capability* and hands over the judgment:

- **What to review?** The model picks the most valuable target from your conversation —
  you don't have to spell it out.
- **One critic or several in parallel?** The model decides, splitting large scope into
  focused reviewers however it sees fit.

The only thing Critic Guy locks down is the **boundary** — and it locks it down with
*mechanism*, not by asking the model nicely:

- The critic spawns as a fresh `pi -p` session with **read-only tools** (`read`, `grep`,
  `find`, `ls`) — it physically cannot edit files, write files, or run shell commands.
- `--offline -ne` means the child never hangs on startup network calls and never
  re-loads this extension (so no runaway nesting).
- Its persona refuses to read credentials, secrets, or dotfiles.

> **Freedom in the middle, hard rails at the edge.**
> Judgment goes to the model; safety is enforced in code.

That's the whole philosophy — and it's why Critic Guy stays a tiny prompt injection
instead of a 1000-line tool. It's the most pi-native way to get a critic.

## Highlights

- 🪶 **Zero dependencies, zero config** — no companion extension, no `reviewer.md`,
  nothing to install beyond this package.
- 🔒 **Safe by construction** — the reviewer is read-only and isolated; the boundary is
  enforced by `--tools`, not by trust.
- 🧠 **Model-driven** — you decide *that* you want a review; the model decides *what* and
  *how*.
- 💸 **Zero overhead when idle** — instructions are injected **only** on turns where you
  actually type `critic`. Silent the rest of the time.
- 🎯 **Model-aware** — resolves the reviewer model from your current session, or one you
  name with `using <name>` / `model=<id>`.

## Install

```bash
# From npm
pi add npm:@nukcole-xinluo9510/pi-critic-guy

# Or from a local checkout during development
pi add /path/to/pi-critic-guy
```

That's it. No other setup.

## Usage

In any pi session, just mention `critic`:

| You type | What happens |
|---|---|
| `critic` | Model picks the most valuable thing from the conversation and reviews it |
| `critic review the auth code` | Targeted review of what you point at |
| `critic using claude` | Spawn the critic on a model matching "claude" |
| `critic model=deepseek-v4-flash` | Spawn the critic on an exact model id |

Word-boundary matching means `critical`, `criticism`, etc. will **not** trigger it —
only a standalone `critic`.

## How it works

Critic Guy hooks `before_agent_start`. On any turn where you mention `critic`:

1. It resolves the reviewer model (your current model, the registry, or one you named).
2. It appends a short **"Capability: Critic Guy"** section to the system prompt — the
   capability, the resolved model id, and one spawn command with the hard-boundary flags.
3. The model spawns one or more critics:
   ```bash
   pi -p --offline -ne --no-session -nc --model "<resolved>" \
     --tools read,grep,find,ls \
     --append-system-prompt "<reviewer persona>" \
     "Task: review <files> ..."
   ```
4. Each critic reads the named files in its own isolated context and returns a critique,
   which the model relays to you.

If the system prompt is already very large, Critic Guy skips injection that turn and says
so — it never silently no-ops.

## Requirements

- pi 0.79+

(Yes, that's the whole list.)

## Development

```bash
npm run check   # tsc --noEmit
npm test        # node --test (matchModel + parseModelQuery)
```

## License

MIT
