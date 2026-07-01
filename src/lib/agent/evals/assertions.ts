/**
 * Structural assertions for agent eval scenarios — checks tool-call sequences,
 * not exact SQL output.
 */

export interface RecordedToolCall {
	tool: string;
	args?: Record<string, unknown>;
}

export interface EvalScenario {
	id: string;
	description: string;
	prompt: string;
	/** Mocked LLM transcript: alternating assistant tool calls and user tool results */
	transcript: Array<
		| { role: 'assistant'; toolCalls: RecordedToolCall[] }
		| { role: 'user'; content: string }
		| { role: 'assistant'; done: true }
	>;
	assertions: EvalAssertion[];
}

export type EvalAssertion =
	| { type: 'tool_before'; before: string; after: string }
	| { type: 'tool_called'; tool: string }
	| { type: 'tool_not_called'; tool: string }
	| { type: 'tool_before_any_create'; investigate: string };

export function extractToolSequence(transcript: EvalScenario['transcript']): string[] {
	const tools: string[] = [];
	for (const turn of transcript) {
		if (turn.role === 'assistant' && 'toolCalls' in turn) {
			for (const tc of turn.toolCalls) tools.push(tc.tool);
		}
	}
	return tools;
}

export function runAssertions(
	tools: string[],
	assertions: EvalAssertion[]
): { passed: boolean; failures: string[] } {
	const failures: string[] = [];

	for (const a of assertions) {
		switch (a.type) {
			case 'tool_before': {
				const beforeIdx = tools.indexOf(a.before);
				const afterIdx = tools.indexOf(a.after);
				if (afterIdx === -1) break; // after not required if never reached
				if (beforeIdx === -1 || beforeIdx > afterIdx) {
					failures.push(`Expected ${a.before} before ${a.after}, got: ${tools.join(' → ')}`);
				}
				break;
			}
			case 'tool_called': {
				if (!tools.includes(a.tool)) {
					failures.push(`Expected tool ${a.tool} to be called`);
				}
				break;
			}
			case 'tool_not_called': {
				if (tools.includes(a.tool)) {
					failures.push(`Expected tool ${a.tool} NOT to be called`);
				}
				break;
			}
			case 'tool_before_any_create': {
				const createIdx = tools.findIndex((t) => t === 'create_cell');
				const invIdx = tools.indexOf(a.investigate);
				if (createIdx !== -1 && (invIdx === -1 || invIdx > createIdx)) {
					failures.push(
						`Expected ${a.investigate} before first create_cell, got: ${tools.join(' → ')}`
					);
				}
				break;
			}
		}
	}

	return { passed: failures.length === 0, failures };
}

export function evaluateScenario(scenario: EvalScenario): {
	passed: boolean;
	failures: string[];
	tools: string[];
} {
	const tools = extractToolSequence(scenario.transcript);
	const { passed, failures } = runAssertions(tools, scenario.assertions);
	return { passed, failures, tools };
}
