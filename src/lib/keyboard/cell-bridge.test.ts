import { describe, expect, it } from 'vitest';
import { handleDdDelete, resetDdPending } from './cell-bridge.svelte';

describe('handleDdDelete', () => {
	it('requires two presses within timeout', () => {
		resetDdPending();
		const el = {} as HTMLElement;
		expect(handleDdDelete('cell-1', el)).toBe(false);
		expect(handleDdDelete('cell-1', el)).toBe(true);
		resetDdPending();
	});

	it('resets when cell id changes', () => {
		resetDdPending();
		const el = {} as HTMLElement;
		handleDdDelete('cell-1', el);
		expect(handleDdDelete('cell-2', el)).toBe(false);
		resetDdPending();
	});
});
