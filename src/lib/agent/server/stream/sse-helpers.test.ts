import { describe, it, expect } from 'vitest';
import { extractRawJsonToolCalls, normalizeToolCallArgs, stripOpenTag } from './sse-helpers.js';

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
