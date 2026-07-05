import type { AIChatToolCall, AIChatToolName } from '$lib/types/ai-chat.js';
import { parseToolCallObject } from '$lib/services/tool-call-parse.js';

export interface SSEController {
	enqueue: (data: string) => void;
	close: () => void;
}

export function send(sc: SSEController, event: Record<string, unknown>): void {
	try {
		sc.enqueue(`data: ${JSON.stringify(event)}\n\n`);
	} catch {
		// stream closed
	}
}

/**
 * Parse a raw tool-call payload (either the inside of a <tool_call> tag or a bare
 * {"tool":...} JSON object) and emit a tool_call SSE event. Centralises the parse +
 * normalise + allowedTools-gate logic that was duplicated across every streaming and
 * final-flush site, so the lenient parser applies uniformly. Returns true if a tool
 * call was emitted.
 */
export function emitToolCall(
	ctrl: SSEController,
	raw: string,
	allowedTools: AIChatToolName[] | undefined,
	nextCallId: () => string
): boolean {
	const call = parseToolCallObject(raw);
	if (!call || typeof call.tool !== 'string') return false;
	const toolCall: AIChatToolCall = {
		callId: typeof call.callId === 'string' ? call.callId : nextCallId(),
		tool: call.tool as AIChatToolName,
		args: normalizeToolCallArgs(call) as unknown as AIChatToolCall['args']
	};
	if (allowedTools && !allowedTools.includes(toolCall.tool)) return false;
	send(ctrl, { type: 'tool_call', call: toolCall });
	return true;
}

/** Extract complete <done>...</done> blocks from buffer, emit suggestions events. */
export function flushDoneBlocks(buffer: string, onDone: (suggestions: string[]) => void): string {
	const OPEN = '<done>';
	const CLOSE = '</done>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		try {
			const payload = JSON.parse(raw) as { suggestions?: string[] };
			if (Array.isArray(payload.suggestions)) onDone(payload.suggestions);
		} catch {
			/* skip malformed */
		}
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/**
 * Extract complete bare {"suggestions":[...]} JSON objects from buffer.
 * Fallback for models (typically cloud/native-tool) that output suggestions JSON
 * without <done> tags. Applied after flushDoneBlocks so proper <done> blocks win.
 */
export function flushBareSuggestionsJson(
	buffer: string,
	onSuggestions: (suggestions: string[]) => void
): string {
	const re = /\{"suggestions"\s*:/g;
	let match: RegExpExecArray | null;
	const ranges: [number, number][] = [];

	while ((match = re.exec(buffer)) !== null) {
		const start = match.index;
		let depth = 0;
		let end = -1;
		for (let i = start; i < buffer.length; i++) {
			if (buffer[i] === '{') depth++;
			else if (buffer[i] === '}') {
				depth--;
				if (depth === 0) {
					end = i + 1;
					break;
				}
			}
		}
		if (end === -1) continue; // incomplete — skip, stripOpenTag holds it back
		const raw = buffer.slice(start, end);
		try {
			const payload = JSON.parse(raw) as { suggestions?: string[] };
			if (Array.isArray(payload.suggestions)) {
				onSuggestions(payload.suggestions);
				ranges.push([start, end]);
			}
		} catch {
			/* skip malformed */
		}
	}

	// Remove matched ranges in reverse so slice indices stay valid
	let result = buffer;
	for (let i = ranges.length - 1; i >= 0; i--) {
		const [start, end] = ranges[i];
		result = result.slice(0, start) + result.slice(end);
	}
	return result;
}

/**
 * Extract complete <plan_proposal>...</plan_proposal> blocks from buffer.
 * The modeling subagent emits one of these at the end of Phase 2 so the client
 * can surface a "here's what I'll build — approve?" card before sql-gen starts.
 */
export function flushPlanProposalBlocks(buffer: string, onProposal: (raw: string) => void): string {
	const OPEN = '<plan_proposal>';
	const CLOSE = '</plan_proposal>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onProposal(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <sprint>[...]</sprint> blocks from buffer, emit sprint_tasks events. */
export function flushSprintBlocks(buffer: string, onSprint: (raw: string) => void): string {
	const OPEN = '<sprint>';
	const CLOSE = '</sprint>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onSprint(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <sprint_update>[...]</sprint_update> blocks from buffer. */
export function flushSprintUpdateBlocks(buffer: string, onUpdate: (raw: string) => void): string {
	const OPEN = '<sprint_update>';
	const CLOSE = '</sprint_update>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onUpdate(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <plan>...</plan> blocks from buffer, emit plan_delta events. */
export function flushPlanBlocks(buffer: string, onPlan: (raw: string) => void): string {
	const OPEN = '<plan>';
	const CLOSE = '</plan>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onPlan(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <tool_call>...</tool_call> blocks from buffer, emit events for each. */
export function flushToolCalls(buffer: string, onToolCall: (raw: string) => void): string {
	const TAG_OPEN = '<tool_call>';
	const TAG_CLOSE = '</tool_call>';
	const ALT_OPEN = '<calltool';
	const ALT_CLOSE = '</calltool>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(TAG_OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(TAG_CLOSE, start + TAG_OPEN.length);
		if (end === -1) break; // incomplete — keep in buffer

		const raw = remaining.slice(start + TAG_OPEN.length, end).trim();
		onToolCall(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + TAG_CLOSE.length);
		searchFrom = start;
	}

	searchFrom = 0;
	while (true) {
		const start = remaining.indexOf(ALT_OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(ALT_CLOSE, start + ALT_OPEN.length);
		if (end === -1) break;

		const raw = remaining.slice(start + ALT_OPEN.length, end).trim();
		onToolCall(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + ALT_CLOSE.length);
		searchFrom = start;
	}

	return remaining;
}

/**
 * Normalize a parsed tool call object so args are always under `args`.
 * Models differ in how they format tool calls:
 *   {"tool":"create_cell","args":{"outputName":...}}   ← correct
 *   {"tool":"create_cell","arguments":{"outputName":...}}  ← some models
 *   {"tool":"create_cell","outputName":"...","code":"..."}  ← flat (no wrapper)
 */
export function normalizeToolCallArgs(obj: Record<string, unknown>): Record<string, unknown> {
	// Already has a non-empty args object
	if (obj.args && typeof obj.args === 'object' && Object.keys(obj.args as object).length > 0) {
		return obj.args as Record<string, unknown>;
	}
	// "arguments" key (OpenAI native format leaked into text)
	if (obj.arguments && typeof obj.arguments === 'object') {
		return obj.arguments as Record<string, unknown>;
	}
	// Flat format: every key except tool/callId/args/arguments is an arg
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { tool: _t, callId: _c, args: _a, arguments: _ar, ...rest } = obj;
	return rest;
}

/**
 * Some small Ollama models output raw JSON tool call objects as text content
 * instead of using the native tool_calls delta or <tool_call> XML tags.
 * This function detects and extracts those, normalising args format.
 *
 * Handles flat, nested (args/arguments), and mixed formats.
 * Prose before/after the JSON is preserved.
 */
export function extractRawJsonToolCalls(text: string, onToolCall: (raw: string) => void): string {
	let result = text;

	while (true) {
		// Find the next {"tool": pattern anywhere in remaining text
		const matchIdx = result.search(/\{"tool"\s*:/);
		if (matchIdx === -1) break;

		// Find balanced braces starting from matchIdx
		let depth = 0,
			end = -1;
		for (let i = matchIdx; i < result.length; i++) {
			if (result[i] === '{') depth++;
			else if (result[i] === '}') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end === -1) break; // incomplete JSON — leave in buffer

		const candidate = result.slice(matchIdx, end + 1);
		const obj = parseToolCallObject(candidate);
		if (obj && typeof obj.tool === 'string') {
			obj.args = normalizeToolCallArgs(obj);
			onToolCall(JSON.stringify(obj));
			result = result.slice(0, matchIdx) + result.slice(end + 1);
			continue;
		}
		break;
	}

	return result;
}

/**
 * Strip bare plan JSON objects (models that skip <plan> tags).
 * Handles any key order and finds objects via balanced-brace scanning.
 * Emits a plan_delta event for each stripped object.
 */
export function stripBarePlanJson(
	text: string,
	onPlan: (plan: { tables?: string[]; cells?: string[]; approach?: string }) => void
): string {
	let result = text;
	while (true) {
		// Find the start of any bare plan JSON — either {"tables": or {"cells": (any order)
		const matchTables = result.search(/\{"tables"\s*:/);
		const matchCells = result.search(/\{"cells"\s*:/);
		const idx =
			matchTables === -1
				? matchCells
				: matchCells === -1
					? matchTables
					: Math.min(matchTables, matchCells);
		if (idx === -1) break;

		// Find the balanced closing brace
		let depth = 0,
			end = -1;
		for (let i = idx; i < result.length; i++) {
			if (result[i] === '{') depth++;
			else if (result[i] === '}') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end === -1) break; // incomplete — leave in buffer

		const candidate = result.slice(idx, end + 1);
		try {
			const obj = JSON.parse(candidate) as Record<string, unknown>;
			if (Array.isArray(obj.tables) || Array.isArray(obj.cells)) {
				onPlan(obj as { tables?: string[]; cells?: string[]; approach?: string });
				result = result.slice(0, idx) + result.slice(end + 1);
				continue;
			}
		} catch {
			/* not valid JSON — skip past this start */
		}
		break;
	}
	return result;
}

/**
 * Strip complete and partial <think>...</think> blocks from buffered text.
 * Thinking models (e.g. qwen3) emit these before their actual response.
 * Complete blocks are removed; if a block is open but not yet closed, strip
 * from the opening tag onward (it may still be streaming).
 */
export function stripThinkBlocks(text: string): string {
	// Remove complete <think>...</think> blocks
	let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');
	// Remove incomplete open block (no closing tag yet)
	const openIdx = result.lastIndexOf('<think>');
	if (openIdx !== -1 && result.indexOf('</think>', openIdx) === -1) {
		result = result.slice(0, openIdx);
	}
	return result;
}

/**
 * Return the safe-to-emit prefix of `text` by stripping any incomplete
 * tag or raw JSON tool call at the tail. Handles:
 *   - a complete open tag with no close: "<tool_call>{"  → strips from "<"
 *   - a partial open tag at end: "<tool_ca" or just "<" → strips the partial
 *   - an incomplete {"tool":...} JSON at end (in-progress raw JSON tool call)
 */
export function stripOpenTag(text: string): string {
	const TAG = '<tool_call>';
	const ALT_TAG = '<calltool';

	// Remove complete open tag that has no matching close
	const idx = text.lastIndexOf('<tool_call>');
	if (idx !== -1 && text.indexOf('</tool_call>', idx) === -1) {
		return text.slice(0, idx);
	}
	const altIdx = text.lastIndexOf(ALT_TAG);
	if (altIdx !== -1 && text.indexOf('</calltool>', altIdx) === -1) {
		return text.slice(0, altIdx);
	}

	// Hold back incomplete <done> blocks (streaming in)
	const doneIdx = text.lastIndexOf('<done>');
	if (doneIdx !== -1 && text.indexOf('</done>', doneIdx) === -1) {
		return text.slice(0, doneIdx);
	}

	// Hold back incomplete <plan> blocks (multi-line model plans stream slowly)
	const planIdx = text.lastIndexOf('<plan>');
	if (planIdx !== -1 && text.indexOf('</plan>', planIdx) === -1) {
		return text.slice(0, planIdx);
	}

	// Hold back incomplete <plan_proposal> blocks
	const planPropIdx = text.lastIndexOf('<plan_proposal>');
	if (planPropIdx !== -1 && text.indexOf('</plan_proposal>', planPropIdx) === -1) {
		return text.slice(0, planPropIdx);
	}

	// Hold back incomplete <sprint> and <sprint_update> blocks
	const sprintIdx = text.lastIndexOf('<sprint>');
	if (sprintIdx !== -1 && text.indexOf('</sprint>', sprintIdx) === -1) {
		return text.slice(0, sprintIdx);
	}
	const sprintUpdateIdx = text.lastIndexOf('<sprint_update>');
	if (sprintUpdateIdx !== -1 && text.indexOf('</sprint_update>', sprintUpdateIdx) === -1) {
		return text.slice(0, sprintUpdateIdx);
	}

	// Remove partial tag at end (e.g. "<tool_ca", "<t", "<", "<sprint", "<sp")
	const PARTIAL_WATCH = [
		TAG,
		ALT_TAG,
		'<done>',
		'<sprint>',
		'<sprint_update>',
		'<plan>',
		'<plan_proposal>'
	];
	const maxPartial = Math.max(...PARTIAL_WATCH.map((t) => t.length)) - 1;
	const start = Math.max(0, text.length - maxPartial);
	for (let i = start; i < text.length; i++) {
		const tail = text.slice(i);
		if (PARTIAL_WATCH.some((t) => t.startsWith(tail))) {
			return text.slice(0, i);
		}
	}

	// Hold back incomplete raw JSON tool call at end of buffer.
	// (When a model outputs {"tool":...} as plain text, we need to wait
	// for the complete object before extractRawJsonToolCalls can extract it.)
	const jsonIdx = text.search(/\{"tool"\s*:/);
	if (jsonIdx !== -1) {
		let depth = 0;
		for (let i = jsonIdx; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}') {
				depth--;
				if (depth === 0) break;
			}
		}
		if (depth > 0) return text.slice(0, jsonIdx); // incomplete — hold back
	}

	// Hold back incomplete bare plan JSON {"tables":...} — same pattern as above.
	// Models sometimes emit plan JSON without <plan> tags; we need the complete
	// object before the bare-plan regex can match and strip it.
	const planJsonIdx = text.search(/\{"tables"\s*:/);
	if (planJsonIdx !== -1) {
		let depth = 0;
		for (let i = planJsonIdx; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}') {
				depth--;
				if (depth === 0) break;
			}
		}
		if (depth > 0) return text.slice(0, planJsonIdx); // incomplete — hold back
	}

	// Hold back incomplete bare suggestions JSON {"suggestions":...}.
	// Cloud models often output suggestions without <done> tags; flushBareSuggestionsJson
	// extracts them but needs the complete object first.
	const suggestionsJsonIdx = text.search(/\{"suggestions"\s*:/);
	if (suggestionsJsonIdx !== -1) {
		let depth = 0;
		for (let i = suggestionsJsonIdx; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}') {
				depth--;
				if (depth === 0) break;
			}
		}
		if (depth > 0) return text.slice(0, suggestionsJsonIdx); // incomplete — hold back
	}

	return text;
}
