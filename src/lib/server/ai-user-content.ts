import type { AIChatCell } from '$lib/types/ai-chat.js';

function codeFenceLang(c: AIChatCell): string {
	if (c.cellType === 'python') return 'python';
	if (c.cellType === 'markdown') return 'markdown';
	return c.language === 'prql' ? 'prql' : 'sql';
}

/** Build the final user turn: focus note + message + full code for attached / referenced / error cells. */
export function buildUserContent(
	cells: AIChatCell[],
	messages: Array<{ role: string; content: string }>
): string {
	const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
	const referencedOutputNames = new Set(
		cells.filter((c) => c.outputName && lastUserMsg.includes(c.outputName)).map((c) => c.outputName)
	);

	// Cells explicitly attached via "Share with AI" — always include full code and steer edits.
	const attachedCells = cells.filter((c) => c.isContextCell && c.outputName);
	for (const c of attachedCells) referencedOutputNames.add(c.outputName);

	// Error cells always get full code — LLM needs it even when the user says "fix it" vaguely.
	for (const c of cells) {
		if (c.status === 'error' && c.code.trim() && c.outputName) {
			referencedOutputNames.add(c.outputName);
		}
	}

	const focusPrefix =
		attachedCells.length > 0
			? `The user attached these notebook cells as context — focus your work on them (prefer update_cell with cellId set to the cell id or outputName rather than creating duplicates): ${attachedCells.map((c) => `\`${c.outputName}\` (id=${c.id})`).join(', ')}\n\n`
			: '';

	const codeBlocks = cells
		.filter((c) => referencedOutputNames.has(c.outputName) && c.code.trim())
		.map((c) => {
			const errNote = c.status === 'error' && c.errorMessage ? `\n-- Error: ${c.errorMessage}` : '';
			const lang = codeFenceLang(c);
			return `### Cell: ${c.outputName} (${c.language}, id=${c.id})${errNote ? '\n' + errNote : ''}\n\`\`\`${lang}\n${c.code}\n\`\`\``;
		})
		.join('\n\n');

	if (codeBlocks) return `${focusPrefix}${lastUserMsg}\n\n${codeBlocks}`;
	if (focusPrefix) return `${focusPrefix}${lastUserMsg}`;
	return lastUserMsg;
}
