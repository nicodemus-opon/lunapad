/**
 * Chunk-boundary tests for the unified SSE parser.
 * Verifies tool-call events are not lost when split across TCP reads.
 */
import { describe, expect, it } from 'vitest';
import { createSSEParser } from './parse-sse.js';

describe('parse-sse chunk boundaries', () => {
	it('parses a complete event in one push', () => {
		const p = createSSEParser();
		const events = p.push('data: {"type":"text_delta","delta":"hi"}\n\n');
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('text_delta');
	});

	it('reassembles an event split across two pushes', () => {
		const p = createSSEParser();
		const line = 'data: {"type":"tool_call","call":{"tool":"sample_data"}}\n\n';
		const mid = Math.floor(line.length / 2);
		expect(p.push(line.slice(0, mid))).toHaveLength(0);
		const events = p.push(line.slice(mid));
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('tool_call');
	});

	it('handles multiple events with partial final line', () => {
		const p = createSSEParser();
		const chunk1 =
			'data: {"type":"text_delta","delta":"a"}\n\ndata: {"type":"text_delta","delta":"b"}\n\ndata: {"type":"done"';
		const chunk2 = '}\n\n';
		const e1 = p.push(chunk1);
		expect(e1).toHaveLength(2);
		const e2 = p.push(chunk2);
		expect(e2).toHaveLength(1);
		expect(e2[0].type).toBe('done');
	});

	it('flush emits trailing event without newline', () => {
		const p = createSSEParser();
		p.push('data: {"type":"truncated","reason":"length"}');
		const flushed = p.flush();
		expect(flushed).toHaveLength(1);
		expect(flushed[0].type).toBe('truncated');
	});
});
