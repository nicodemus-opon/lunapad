import { describe, expect, it, vi, afterEach } from 'vitest';
import { clampContextMenuPosition, clampMenuPosition, handleMenuKeyDown } from './menu-utils';
import { rankRefEntries } from './mention-utils';

function stubViewport(width: number, height: number) {
	vi.stubGlobal('window', { innerWidth: width, innerHeight: height });
}

describe('clampMenuPosition', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('opens below anchor by default', () => {
		stubViewport(800, 600);
		const pos = clampMenuPosition(
			{ top: 100, left: 200, bottom: 120, right: 280 },
			{ width: 288, height: 320 }
		);
		expect(pos.top).toBe(126);
		expect(pos.left).toBe(200);
	});

	it('flips when below would clip', () => {
		stubViewport(800, 600);
		const pos = clampMenuPosition(
			{ top: 500, left: 200, bottom: 520, right: 280 },
			{ width: 288, height: 320 }
		);
		expect(pos.top + 320).toBeLessThanOrEqual(592);
		expect(pos.left).toBeGreaterThanOrEqual(8);
		expect(pos.left + 288).toBeLessThanOrEqual(792);
	});

	it('flips beside popover to the left when right side clips', () => {
		stubViewport(800, 600);
		const pos = clampMenuPosition(
			{ top: 300, left: 700, bottom: 360, right: 780 },
			{ width: 320, height: 400 },
			{ placement: 'beside', gap: 12 }
		);
		expect(pos.left + 320).toBeLessThanOrEqual(792);
		expect(pos.left).toBeLessThan(700);
	});

	it('keeps beside popover on the right when there is room', () => {
		stubViewport(1200, 800);
		const pos = clampMenuPosition(
			{ top: 300, left: 200, bottom: 360, right: 400 },
			{ width: 320, height: 400 },
			{ placement: 'beside', gap: 12 }
		);
		expect(pos.left).toBe(412);
		expect(pos.top).toBe(300);
	});
});

describe('menu-utils', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('clamps context menu inside viewport', () => {
		stubViewport(800, 600);
		const pos = clampContextMenuPosition(9999, 9999, { width: 160, height: 200 });
		expect(pos.left).toBeLessThan(9999);
		expect(pos.top).toBeLessThan(9999);
		expect(pos.left + 160).toBeLessThanOrEqual(792);
		expect(pos.top + 200).toBeLessThanOrEqual(592);
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
