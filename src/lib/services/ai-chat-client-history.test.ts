import { describe, expect, it } from 'vitest';
import { selectConversationHistory } from './ai-chat-client';

type Turn = { role: 'user' | 'assistant'; content: string };

function turn(role: 'user' | 'assistant', content: string): Turn {
	return { role, content };
}

describe('selectConversationHistory', () => {
	it('keeps everything verbatim for short conversations (<= 7 messages)', () => {
		const msgs = Array.from({ length: 7 }, (_, i) => turn('user', `msg ${i}`));
		const { conversationMessages, dropped } = selectConversationHistory(msgs, new Set());
		expect(conversationMessages).toEqual(msgs);
		expect(dropped).toEqual([]);
	});

	it('always keeps the first message and the last 6', () => {
		const msgs = Array.from({ length: 20 }, (_, i) => turn('user', `msg ${i}`));
		const { conversationMessages } = selectConversationHistory(msgs, new Set());
		expect(conversationMessages[0].content).toBe('msg 0');
		const last6 = conversationMessages.slice(-6).map((m) => m.content);
		expect(last6).toEqual(['msg 14', 'msg 15', 'msg 16', 'msg 17', 'msg 18', 'msg 19']);
	});

	it('keeps older messages that mention an active cell outputName', () => {
		const msgs = [
			turn('user', 'msg 0'),
			turn('assistant', 'building orders_clean now'),
			...Array.from({ length: 15 }, (_, i) => turn('user', `filler ${i}`))
		];
		const { conversationMessages } = selectConversationHistory(msgs, new Set(['orders_clean']));
		expect(conversationMessages.some((m) => m.content.includes('orders_clean'))).toBe(true);
	});

	it('does not grow unboundedly: many distinct active outputNames mentioned across a long session stay within the token budget', () => {
		// Pathological case from the plan: a long session where many distinct outputNames get
		// mentioned in many older messages — without budgeting, `relevant` would include all of
		// them regardless of how large the conversation gets.
		const outputNames = Array.from({ length: 50 }, (_, i) => `model_${i}`);
		const relevantMsgs = outputNames.map((name) =>
			turn('assistant', `Building ${name} now — ${'x'.repeat(2000)}`)
		);
		const msgs = [
			turn('user', 'start'),
			...relevantMsgs,
			...Array.from({ length: 6 }, (_, i) => turn('user', `recent ${i}`))
		];

		const { conversationMessages, dropped } = selectConversationHistory(msgs, new Set(outputNames));

		// Not all 50 relevant messages survive the budget — some get dropped instead of growing
		// the prompt without bound.
		expect(dropped.length).toBeGreaterThan(0);
		expect(conversationMessages.length).toBeLessThan(msgs.length);
	});

	it('prioritizes more recently mentioned relevant messages over older ones when the budget is tight', () => {
		const big = 'x'.repeat(2000);
		const msgs = [
			turn('user', 'start'),
			turn('assistant', `old mention of target_model ${big}`),
			...Array.from({ length: 5 }, (_, i) => turn('user', `filler ${i} ${big}`)),
			turn('assistant', `recent mention of target_model ${big}`),
			...Array.from({ length: 6 }, (_, i) => turn('user', `recent ${i}`))
		];
		const { conversationMessages } = selectConversationHistory(msgs, new Set(['target_model']));
		const mentions = conversationMessages.filter((m) => m.content.includes('target_model'));
		// At minimum the most recent mention must survive even under a tight budget.
		expect(mentions.some((m) => m.content.includes('recent mention'))).toBe(true);
	});

	it('retains the most recent <plan>-containing message as an intent anchor', () => {
		const msgs = [
			turn('user', 'start'),
			turn('assistant', '<plan>{"models":["a"]}</plan>'),
			...Array.from({ length: 15 }, (_, i) => turn('user', `filler ${i}`))
		];
		const { conversationMessages } = selectConversationHistory(msgs, new Set());
		expect(conversationMessages.some((m) => m.content.includes('<plan>'))).toBe(true);
	});

	it('reports dropped messages in chronological order', () => {
		const big = 'x'.repeat(3000);
		const msgs = [
			turn('user', 'start'),
			...Array.from({ length: 10 }, (_, i) => turn('assistant', `mentions target ${i} ${big}`)),
			...Array.from({ length: 6 }, (_, i) => turn('user', `recent ${i}`))
		];
		const { dropped } = selectConversationHistory(msgs, new Set(['target']));
		const indices = dropped.map((m) => Number(m.content.match(/target (\d+)/)?.[1]));
		const sorted = [...indices].sort((a, b) => a - b);
		expect(indices).toEqual(sorted);
	});
});
