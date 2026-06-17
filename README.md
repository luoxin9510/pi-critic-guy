# 🧐 Critic Guy

A pi extension that activates **only when the user types "critic"**.

## How It Works

```
用户: "帮忙 critic 一下这段代码"
        ↓
before_agent_start hook → 检测到 "critic"
        ↓
注入 critic 指令到 system prompt（仅本轮，每次提到 critic 都注入）
        ↓
LLM 看到能力，用 bash spawn 一个独立 pi 子进程（命令模板由扩展注入，含解析好的模型）：
  pi -p --offline -ne --no-session -nc --model "<resolved>" \
     --tools read,grep,find,ls --append-system-prompt "..." "Task: review..."
        ↓
子进程只有只读工具（read/grep/find/ls）——不能改文件、不能跑任意命令
        ↓
text 模式直接输出评论纯文本 → LLM 展示给用户
```

> `--offline -ne` 是必须的：跳过 pi 的启动期网络操作（否则子进程冷启动可能卡几分钟），
> 并避免在子进程里重复加载本扩展。大范围 review 时，扩展会指导 LLM **拆成多个并行子 agent**，
> 各自写独立文件后汇总，避免输出交错。

**用户没说 "critic" 时 → 零开销，不影响任何对话。**

## 只读保证

critic 子进程用 `--tools read,grep,find,ls`,这正是 pi 内置的只读工具集——
不包含 `bash`/`edit`/`write`,所以它无法修改工作区或执行任意命令，只能读取和检索代码做评审。

## 前置条件

critic 子进程会真的调一次模型 API，所以**至少要有一个可用的 provider 凭证**
（pi 里 `/login`，或对应 provider 的 API key env）。没有任何凭证时 spawn 出的
子进程会直接失败。

## 安装

这是一个本地 extension,用 pi 的 install 命令指向本目录即可：

```bash
pi install /path/to/pi-critic-guy
```

模型选择是动态的：扩展会按「用户指定 > 当前会话模型 > registry 首个可用 > 兜底模型」
自动解析，无需配置环境变量。想临时指定模型，直接在 prompt 里写即可（见下）。

## 使用

用户只需要在 prompt 里包含 "critic" 一词：

```
用户: "critic 一下这段代码"
用户: "帮我 critic review auth 模块"
用户: "让 Critic Guy 看看这个设计"
```

指定 critic 用哪个模型（可选）：

```
用户: "critic using claude"
用户: "critic model=deepseek 看看这段实现"
```

LLM 会自动读取扩展注入的指令，用 `pi` CLI spawn 子进程进行 review。

## License

MIT
