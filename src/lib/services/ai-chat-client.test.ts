import { describe, expect, it } from 'vitest';
import { wantsNotebookRendering } from './ai-chat-client.js';

describe('wantsNotebookRendering', () => {
	it('recognizes notebook composition requests beyond dashboard/chart wording', () => {
		for (const prompt of [
			'build a notebook report for revenue',
			'create docs for this analysis',
			'document the findings from these cells',
			'compose a notebook summary around the results',
			'add insights sections after building the models'
		]) {
			expect(wantsNotebookRendering(prompt), prompt).toBe(true);
		}
	});

	it('does not trigger for plain model-building requests with no presentation ask', () => {
		for (const prompt of [
			'build a staging model for orders',
			'create a fact table for sessions',
			'generate a revenue metric'
		]) {
			expect(wantsNotebookRendering(prompt), prompt).toBe(false);
		}
	});
});
