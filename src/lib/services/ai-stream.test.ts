import { describe, it, expect } from 'vitest';
import { createSSEParser, type SSEEvent } from './ai-stream.js';

/** Feed `text` to the parser one byte at a time — the worst-case fragmentation. */
function parseByteByByte(text: string): SSEEvent[] {
	const p = createSSEParser();
	const out: SSEEvent[] = [];
	for (const ch of text) out.push(...p.push(ch));
	out.push(...p.flush());
	return out;
}

const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

describe('createSSEParser', () => {
	it('parses well-formed events delivered in one chunk', () => {
		const p = createSSEParser();
		const events = p.push(sse([{ type: 'text_delta', delta: 'hi' }, { type: 'done' }]));
		expect(events.map((e) => e.type)).toEqual(['text_delta', 'done']);
		expect(events[0].delta).toBe('hi');
	});

	it('does not drop an event split across chunk boundaries (mid-JSON)', () => {
		// The original bug: a `data:` line arriving in two reads was silently lost.
		const line = `data: ${JSON.stringify({ type: 'tool_call', call: { tool: 'create_cell' } })}\n\n`;
		const mid = Math.floor(line.length / 2);
		const p = createSSEParser();
		expect(p.push(line.slice(0, mid))).toEqual([]); // incomplete — nothing yet
		const events = p.push(line.slice(mid));
		expect(events).toHaveLength(1);
		expect((events[0].call as { tool: string }).tool).toBe('create_cell');
	});

	it('survives byte-by-byte delivery of many events', () => {
		const input = sse([
			{ type: 'text_delta', delta: 'The ' },
			{ type: 'text_delta', delta: 'answer.' },
			{ type: 'suggestions', suggestions: ['next'] },
			{ type: 'done' }
		]);
		const events = parseByteByByte(input);
		expect(events.map((e) => e.type)).toEqual(['text_delta', 'text_delta', 'suggestions', 'done']);
		expect(
			events
				.map((e) => e.delta)
				.filter(Boolean)
				.join('')
		).toBe('The answer.');
	});

	it('handles SQL payloads containing newlines inside the JSON string across byte splits', () => {
		const ev = {
			type: 'tool_call',
			call: { tool: 'update_cell', args: { code: 'SELECT 1\nFROM t' } }
		};
		const events = parseByteByByte(`data: ${JSON.stringify(ev)}\n\n`);
		expect(events).toHaveLength(1);
		expect((events[0].call as { args: { code: string } }).args.code).toBe('SELECT 1\nFROM t');
	});

	it('emits a trailing event that lacks a final newline via flush()', () => {
		const p = createSSEParser();
		expect(p.push('data: {"type":"done"}')).toEqual([]); // no newline yet
		expect(p.flush().map((e) => e.type)).toEqual(['done']);
	});

	it('skips non-data lines and blank lines', () => {
		const p = createSSEParser();
		const events = p.push(':comment\n\ndata: {"type":"done"}\n\n');
		expect(events.map((e) => e.type)).toEqual(['done']);
	});

	it('skips a complete-but-malformed data line without throwing', () => {
		const p = createSSEParser();
		const events = p.push('data: {not json}\ndata: {"type":"done"}\n');
		expect(events.map((e) => e.type)).toEqual(['done']);
	});
});
