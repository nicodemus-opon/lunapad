import { describe, expect, it } from 'vitest';
import { chordMatchesEvent, findMatchingShortcut } from './match';
import type { KeyChord, ShortcutContext, ShortcutDef } from './types';

function keyEvent(init: {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
}): KeyboardEvent {
	return {
		key: init.key,
		metaKey: init.metaKey ?? false,
		ctrlKey: init.ctrlKey ?? false,
		shiftKey: init.shiftKey ?? false,
		altKey: init.altKey ?? false
	} as KeyboardEvent;
}

function mockCtx(overrides: Partial<ShortcutContext> = {}): ShortcutContext {
	return {
		event: keyEvent({ key: 'k' }),
		contexts: ['global'],
		cellId: null,
		cellEl: null,
		stageEditorEl: null,
		stageMenuEl: null,
		isTypingTarget: false,
		isNativeInputTarget: false,
		...overrides
	};
}

describe('chordMatchesEvent', () => {
	it('matches mod+k without shift', () => {
		const chord: KeyChord = { key: 'k', mod: true };
		const e = keyEvent({ key: 'k', metaKey: true });
		expect(chordMatchesEvent(chord, e)).toBe(true);
	});

	it('rejects shift when chord has no shift', () => {
		const chord: KeyChord = { key: 'k', mod: true };
		const e = keyEvent({ key: 'k', metaKey: true, shiftKey: true });
		expect(chordMatchesEvent(chord, e)).toBe(false);
	});

	it('matches plain key in command mode', () => {
		const chord: KeyChord = { key: 'j', plain: true };
		const e = keyEvent({ key: 'j' });
		expect(chordMatchesEvent(chord, e)).toBe(true);
	});

	it('rejects plain key when mod held', () => {
		const chord: KeyChord = { key: 'j', plain: true };
		const e = keyEvent({ key: 'j', metaKey: true });
		expect(chordMatchesEvent(chord, e)).toBe(false);
	});
});

describe('findMatchingShortcut', () => {
	const shortcuts: ShortcutDef[] = [
		{
			id: 'palette',
			chord: { key: 'k', mod: true },
			contexts: ['global', 'monaco-code'],
			group: 'global',
			label: 'Palette',
			priority: 100,
			when: (ctx) => !ctx.event.shiftKey,
			handler: () => {}
		},
		{
			id: 'inline-ai',
			chord: { key: 'k', mod: true, shift: true },
			contexts: ['monaco-code'],
			group: 'cell-editor',
			label: 'Inline AI',
			priority: 70,
			handler: () => {}
		}
	];

	it('Cmd+K resolves to palette in global context', () => {
		const e = keyEvent({ key: 'k', metaKey: true });
		const match = findMatchingShortcut(shortcuts, e, mockCtx({ contexts: ['global'] }));
		expect(match?.id).toBe('palette');
	});

	it('Cmd+Shift+K resolves to inline-ai in monaco-code context', () => {
		const e = keyEvent({ key: 'k', metaKey: true, shiftKey: true });
		const match = findMatchingShortcut(
			shortcuts,
			e,
			mockCtx({ contexts: ['monaco-code', 'global'] })
		);
		expect(match?.id).toBe('inline-ai');
	});

	it('picks higher priority when multiple match', () => {
		const e = keyEvent({ key: 'k', metaKey: true });
		const match = findMatchingShortcut(
			shortcuts,
			e,
			mockCtx({ contexts: ['monaco-code', 'global'] })
		);
		expect(match?.id).toBe('palette');
	});
});
