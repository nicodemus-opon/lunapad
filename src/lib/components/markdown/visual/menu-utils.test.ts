import { describe, expect, it, vi } from 'vitest';
import { clampContextMenuPosition, handleMenuKeyDown } from './menu-utils';
import { rankRefEntries } from './mention-utils';

describe('menu-utils', () => {
	it('clamps context menu inside viewport', () => {
		vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
		const pos = clampContextMenuPosition(9999, 9999, { width: 160, height: 200 });
		expect(pos.left).toBeLessThan(9999);
		expect(pos.top).toBeLessThan(9999);
		vi.unstubAllGlobals();
	});

	it('does not loop menu selection at ends', () => {
		let selected = 1;
		const down = handleMenuKeyDown(
			{ key: 'ArrowDown', preventDefault: () => {} } as KeyboardEvent,
			{
				itemCount: () => 2,
				getSelectedIndex: () => selected,
				setSelectedIndex: (i) => {
					selected = i;
				},
				selectAt: () => {},
				close: () => {}
			}
		);
		expect(down).toBe(true);
		expect(selected).toBe(1);
	});
});

describe('mention-utils', () => {
	it('ranks exact cell name matches higher', () => {
		const { visible } = rankRefEntries(
			'orders',
			[
				{ cellName: 'customers', columns: [] },
				{ cellName: 'orders', columns: [] }
			],
			[],
			new Set(['orders'])
		);
		expect(visible[0]?.entry.cellName).toBe('orders');
	});
});
