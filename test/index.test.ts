import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchModel, parseModelQuery } from "../extensions/critic-guy.ts";

const MODELS = [
	{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
	{ id: "claude-opus-4-8", name: "Claude Opus 4.8" },
	{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
	{ id: "gpt-4.1", name: "GPT-4.1" },
];

describe("parseModelQuery", () => {
	const cases: Array<[string, string]> = [
		["critic using claude", "claude"],
		["critic model=deepseek", "deepseek"],
		["critic model: gpt-4.1", "gpt-4.1"],
		["critic using 通义", "通义"], // non-ASCII model name
		['critic model="claude"', "claude"], // quoted value
		["critic", ""],
		["", ""],
		// "with" must NOT be parsed as a model spec — it mis-captures filler words
		["critic review auth with the team please", ""],
		["帮忙 critic 一下这段代码", ""],
	];
	for (const [input, expected] of cases) {
		it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
			assert.equal(parseModelQuery(input), expected);
		});
	}
});

describe("matchModel", () => {
	it("returns null for empty query", () => {
		assert.equal(matchModel("", MODELS), null);
	});

	it("matches exact id (case-insensitive)", () => {
		assert.equal(matchModel("CLAUDE-OPUS-4-8", MODELS), "claude-opus-4-8");
	});

	it("matches exact name (case-insensitive)", () => {
		assert.equal(matchModel("deepseek v4 flash", MODELS), "deepseek-v4-flash");
	});

	it("matches partial on id or name", () => {
		assert.equal(matchModel("opus", MODELS), "claude-opus-4-8");
		assert.equal(matchModel("gpt", MODELS), "gpt-4.1");
	});

	it("returns null when nothing matches (no silent substitution)", () => {
		assert.equal(matchModel("nonexistent-model", MODELS), null);
	});

	it("returns null against an empty registry", () => {
		assert.equal(matchModel("claude", []), null);
	});
});
