/**
 * Incremental Server-Sent-Events parser for the AI chat stream.
 *
 * The `/api/ai/chat` endpoint emits `data: {json}\n\n` lines. Over a real network a
 * single line can be split across TCP reads — even mid-JSON — so a naive per-chunk
 * `split('\n')` silently drops any event spanning a chunk boundary (this was a real
 * token/tool-call loss bug). This parser buffers partial lines across `push()` calls and
 * only emits complete, successfully-parsed events.
 */

export interface SSEEvent {
	type: string;
	[key: string]: unknown;
}

function parseLine(line: string): SSEEvent | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) return null;
	const data = trimmed.slice(5).trim();
	if (!data) return null;
	try {
		return JSON.parse(data) as SSEEvent;
	} catch {
		// A complete-but-malformed event line — skip it rather than throw.
		return null;
	}
}

export interface SSEParser {
	/** Feed a decoded text chunk; returns any complete events it completed. */
	push(chunk: string): SSEEvent[];
	/** Call at end-of-stream to emit a trailing event with no final newline. */
	flush(): SSEEvent[];
}

export function createSSEParser(): SSEParser {
	let buffer = '';

	function drain(): SSEEvent[] {
		const events: SSEEvent[] = [];
		let nl: number;
		while ((nl = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, nl);
			buffer = buffer.slice(nl + 1);
			const ev = parseLine(line);
			if (ev) events.push(ev);
		}
		return events;
	}

	return {
		push(chunk: string): SSEEvent[] {
			buffer += chunk;
			return drain();
		},
		flush(): SSEEvent[] {
			const rest = buffer;
			buffer = '';
			const ev = parseLine(rest);
			return ev ? [ev] : [];
		}
	};
}
