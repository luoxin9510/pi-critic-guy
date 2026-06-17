# 🧐 Critic Guy

A pi extension that activates **only when the user types "critic"**.

## How It Works

```
用户: "帮忙 critic 一下这段代码"
        ↓
before_agent_start hook → 检测到 "critic"
        ↓
注入 critic 指令到 system prompt（仅本次对话轮次）
        ↓
LLM 看到能力，用 bash spawn 子进程：
  pi -p --mode json --tools read,bash "Task: review..."
        ↓
子进程只有 read + bash（只读安全）
返回批评结果 → LLM 展示给用户
```

**用户没说 "critic" 时 → 零开销，不影响任何对话。**

## 安装

```bash
npm install pi-critic-guy
```

设置默认模型（可选）：

```bash
export CRITIC_DEFAULT_MODEL="claude-sonnet-4-20250514"
```

## 使用

用户只需要在 prompt 里包含 "critic" 一词：

```
用户: "critic 一下这段代码"
用户: "帮我 critic review auth 模块"
用户: "让 Critic Guy 看看这个设计"
```

LLM 会自动读取扩展注入的指令，用 `pi` CLI spawn 子进程进行 review。

## License

MIT
