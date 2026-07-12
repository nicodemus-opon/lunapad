import { describe, it, expect } from 'vitest';
import {
	extractRawJsonToolCalls,
	normalizeToolCallArgs,
	stripHallucinatedToolResultJson,
	stripOpenTag
} from './sse-helpers.js';

describe('stripOpenTag', () => {
	// Regression: streamed responses arrive in chunks, so a bare-JSON tool call can be split
	// across multiple deltas. The holdback used to anchor on the literal `{"tool":` substring,
	// so any other shape (OpenAI's {"name":...}, {"type":"function","name":...}) streamed in
	// mid-object over several chunks got flushed as visible prose before it was complete —
	// permanently defeating extractRawJsonToolCalls, since the object's prefix was already gone
	// from the buffer by the time the rest arrived.
	it('holds back an incomplete {"name":...} object regardless of key order', () => {
		const text = 'Sure, one moment.{"type": "function", "name": "create_cell", "parameters": {"a"';
		expect(stripOpenTag(text)).toBe('Sure, one moment.');
	});

	it('releases text once the object is fully balanced', () => {
		const text = 'prefix{"type":"function","name":"x","parameters":{"a":1}}suffix';
		expect(stripOpenTag(text)).toBe(text);
	});

	it('does not hold back plain prose with no braces', () => {
		expect(stripOpenTag('Here is your dashboard summary.')).toBe(
			'Here is your dashboard summary.'
		);
	});
});

describe('extractRawJsonToolCalls', () => {
	it('recovers our internal {"tool":...,"args":...} shape', () => {
		const calls: string[] = [];
		const remaining = extractRawJsonToolCalls(
			'{"tool":"create_cell","args":{"outputName":"x","markdown":"# Hi"}}',
			(raw) => calls.push(raw)
		);
		expect(remaining).toBe('');
		expect(calls).toHaveLength(1);
		const parsed = JSON.parse(calls[0]);
		expect(parsed.tool).toBe('create_cell');
		expect(parsed.args.markdown).toBe('# Hi');
	});

	// Regression: OpenAI-compatible models (e.g. NVIDIA-hosted meta/llama-3.1-8b-instruct)
	// sometimes leak their native function-call format as plain text content instead of a
	// proper streaming tool_calls delta. Before this fix the JSON was left untouched and
	// mis-rendered as dashboard markdown, silently failing every dashboard-build prompt.
	it('recovers OpenAI-leaked {"name":...,"parameters":...} shape', () => {
		const calls: string[] = [];
		const remaining = extractRawJsonToolCalls(
			'{"name": "create_cell", "parameters": {"outputName": "x", "cellType": "markdown", "markdown": "# Hi"}}',
			(raw) => calls.push(raw)
		);
		expect(remaining).toBe('');
		expect(calls).toHaveLength(1);
		const parsed = JSON.parse(calls[0]);
		expect(parsed.tool).toBe('create_cell');
		expect(parsed.args.markdown).toBe('# Hi');
	});

	// Regression: meta/llama-3.3-70b-instruct (NVIDIA-hosted) leaks tool calls with a leading
	// "type":"function" key before "name" — the old detection anchored on the literal substring
	// `{"name"` immediately after an opening brace, so key order broke it silently (empty output).
	it('recovers {"type":"function","name":...,"parameters":...} shape regardless of key order', () => {
		const calls: string[] = [];
		const remaining = extractRawJsonToolCalls(
			'{"type": "function", "name": "create_cell", "parameters": {"outputName": "x", "markdown": "# Hi"}}',
			(raw) => calls.push(raw)
		);
		expect(remaining).toBe('');
		expect(calls).toHaveLength(1);
		const parsed = JSON.parse(calls[0]);
		expect(parsed.tool).toBe('create_cell');
		expect(parsed.args.markdown).toBe('# Hi');
	});

	it('recovers nested {"function":{"name":...,"arguments":...}} shape with stringified arguments', () => {
		const calls: string[] = [];
		const remaining = extractRawJsonToolCalls(
			'{"function":{"name":"create_cell","arguments":"{\\"outputName\\":\\"x\\",\\"markdown\\":\\"# Hi\\"}"}}',
			(raw) => calls.push(raw)
		);
		expect(remaining).toBe('');
		expect(calls).toHaveLength(1);
		const parsed = JSON.parse(calls[0]);
		expect(parsed.tool).toBe('create_cell');
		expect(parsed.args.markdown).toBe('# Hi');
	});

	it('leaves plain prose untouched', () => {
		const calls: string[] = [];
		const remaining = extractRawJsonToolCalls('Here is your dashboard summary.', (raw) =>
			calls.push(raw)
		);
		expect(remaining).toBe('Here is your dashboard summary.');
		expect(calls).toHaveLength(0);
	});
});

describe('normalizeToolCallArgs', () => {
	it('prefers "parameters" over flat keys', () => {
		const args = normalizeToolCallArgs({
			name: 'create_cell',
			parameters: { outputName: 'x' }
		});
		expect(args).toEqual({ outputName: 'x' });
	});
});

describe('stripHallucinatedToolResultJson', () => {
	// Regression: a model can hallucinate a *tool result* (e.g. what apply_notebook_patch
	// would return) instead of actually calling the tool. No mutation happens, but the raw
	// JSON used to render verbatim in chat as if it were the assistant's prose response —
	// looking like success while the notebook UI never updated.
	it('strips a hallucinated apply_notebook_patch-shaped result', () => {
		const raw =
			'{"notebookId":"models/staging/new_model_13","name":"new_model_13","document":{"type":"doc","content":[]},"executableCells":[{"cellId":"new_model_13","outputName":"new_model_13","cellType":"query","language":"prql","code":"from x","status":"success","columns":["a"]}]}';
		expect(stripHallucinatedToolResultJson(raw)).toBe('');
	});

	it('preserves prose surrounding the hallucinated JSON', () => {
		const raw = `Done!${'{"notebookId":"nb1","executableCells":[]}'} Let me know if you need anything else.`;
		expect(stripHallucinatedToolResultJson(raw)).toBe(
			'Done! Let me know if you need anything else.'
		);
	});

	it('does not touch a real tool call (has a "tool" key)', () => {
		const raw = '{"tool":"apply_notebook_patch","args":{"notebookId":"nb1","executableCells":[]}}';
		expect(stripHallucinatedToolResultJson(raw)).toBe(raw);
	});

	it('does not touch plain prose', () => {
		expect(stripHallucinatedToolResultJson('Here is your dashboard summary.')).toBe(
			'Here is your dashboard summary.'
		);
	});

	it('leaves an incomplete (still-streaming) object in the buffer', () => {
		const raw = 'Working on it... {"notebookId":"nb1","executableCells":[';
		expect(stripHallucinatedToolResultJson(raw)).toBe(raw);
	});
});
