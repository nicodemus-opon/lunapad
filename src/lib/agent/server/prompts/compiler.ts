/** Prompt template version — bump when system prompt content changes materially. */
export const PROMPT_VERSION = 3;

export type PromptProvider = 'native' | 'ollama_xml';

export interface PromptSlots {
	role: string;
	dialectSection: string;
	cellList: string;
	schemaList: string;
	workspaceMemory?: string;
	sessionDataContext?: string;
	sessionPlanContext?: string;
	workspaceContract?: string;
	schemaChangeNote?: string;
	toolInstructions: string;
	pythonNote?: string;
}

export interface CompiledPrompt {
	version: number;
	provider: PromptProvider;
	content: string;
}

function formatSessionData(ctx?: string): string {
	if (!ctx?.trim()) return '';
	return `\n\n## Data already investigated this session\n${ctx}`;
}

function formatDecisions(ctx?: string): string {
	if (!ctx?.trim()) return '';
	return `\n\n## Established decisions\n${ctx}`;
}

/** Provider adapter: same semantic slots, different surface formatting. */
export function compilePrompt(provider: PromptProvider, slots: PromptSlots): CompiledPrompt {
	const shared = `${slots.role}

${slots.dialectSection}

## Notebook
${slots.cellList}

## Schema
${slots.schemaList}${formatSessionData(slots.sessionDataContext)}${formatDecisions(slots.sessionPlanContext)}${slots.workspaceMemory ? `\n\n## Workspace memory\n${slots.workspaceMemory}` : ''}${slots.workspaceContract ? `\n\n## Modeling standards\n${slots.workspaceContract}` : ''}${slots.schemaChangeNote ? `\n\n## Schema change\n${slots.schemaChangeNote}` : ''}

${slots.toolInstructions}${slots.pythonNote ?? ''}`;

	if (provider === 'ollama_xml') {
		return {
			version: PROMPT_VERSION,
			provider,
			content:
				shared.replace(/## /g, '').replace(/\n\n+/g, '\n') +
				'\n\nUse <tool_call>{"tool":"...","args":{...}}</tool_call> for tools.'
		};
	}

	return {
		version: PROMPT_VERSION,
		provider,
		content: shared
	};
}
