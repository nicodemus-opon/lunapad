import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

// Hex values derived from the OKLCH variables in src/routes/layout.css — keep in sync.
// Token colors are deliberately low-chroma so code sits inside the warm neutral
// scheme instead of shouting over it: hues come from the chart palette but are
// desaturated toward the theme's foreground. The editor background sits one
// step inset from the page so the code block reads as a single quiet surface.

const LIGHT = {
	background: '#f3f1ea', // one step inset from --background
	foreground: '#1f1e1b', // near --foreground
	mutedForeground: '#79716b',
	accent: '#e9e6dc',
	accentForeground: '#1b1d27',
	border: '#d6d3d1',
	ring: '#62748e',
	popover: '#ffffff',
	popoverForeground: '#28261b'
};

const DARK = {
	background: '#1f1e1b', // one step inset from --background
	foreground: '#c3c0b6', // --foreground
	mutedForeground: '#b7b5a9',
	accent: '#1a1915',
	accentForeground: '#f5f4ee',
	border: '#3e3e38',
	ring: '#cad5e2',
	popover: '#30302e',
	popoverForeground: '#e5e5e2'
};

export function defineThemes(monaco: typeof Monaco): void {
	monaco.editor.defineTheme('lunapad-light', {
		base: 'vs',
		inherit: true,
		rules: [
			{ token: 'keyword', foreground: '2f6f9f', fontStyle: 'bold' }, // calm steel blue
			{ token: 'string', foreground: '58804f' }, // sage
			{ token: 'string.escape', foreground: '58804f' },
			// the vs base theme ships legacy high-saturation *.sql rules
			// (string.sql red, predefined.sql magenta) — override them
			{ token: 'string.sql', foreground: '58804f' },
			{ token: 'number', foreground: '9c6b2e' }, // soft ochre
			{ token: 'comment', foreground: '8a8276', fontStyle: 'italic' },
			{ token: 'operator', foreground: '6f6a5e' }, // quiet, near-foreground
			{ token: 'operator.sql', foreground: '6f6a5e' },
			{ token: 'type', foreground: '2e7d86' }, // muted teal
			{ token: 'predefined', foreground: '6a5b9e' }, // muted violet
			{ token: 'predefined.sql', foreground: '6a5b9e' },
			{ token: 'identifier', foreground: '1f1e1b' },
			{ token: 'delimiter', foreground: '8a8276' }
		],
		colors: {
			'editor.background': LIGHT.background,
			'editor.foreground': LIGHT.foreground,
			'editorCursor.foreground': LIGHT.foreground,
			'editor.lineHighlightBackground': LIGHT.accent,
			'editor.selectionBackground': '#0a0a0a14',
			'editor.inactiveSelectionBackground': '#0a0a0a0d',
			'editorLineNumber.foreground': LIGHT.mutedForeground,
			'editorLineNumber.activeForeground': LIGHT.accentForeground,
			'editorBracketMatch.background': '#0a0a0a1a',
			'editorBracketMatch.border': LIGHT.ring,
			'editorSuggestWidget.background': LIGHT.popover,
			'editorSuggestWidget.foreground': LIGHT.popoverForeground,
			'editorSuggestWidget.border': LIGHT.border,
			'editorSuggestWidget.selectedBackground': LIGHT.accent,
			'editorSuggestWidget.selectedForeground': LIGHT.accentForeground,
			'editorWidget.background': LIGHT.popover,
			'editorWidget.border': LIGHT.border
		}
	});

	monaco.editor.defineTheme('lunapad-dark', {
		base: 'vs-dark',
		inherit: true,
		rules: [
			{ token: 'keyword', foreground: '7fb8dd', fontStyle: 'bold' }, // soft steel blue
			{ token: 'string', foreground: 'a9c49a' }, // sage
			{ token: 'string.escape', foreground: 'a9c49a' },
			// the vs-dark base theme ships legacy high-saturation *.sql rules
			// (string.sql red, predefined.sql magenta) — override them
			{ token: 'string.sql', foreground: 'a9c49a' },
			{ token: 'number', foreground: 'd4a972' }, // soft amber
			{ token: 'comment', foreground: '8f8a7d', fontStyle: 'italic' },
			{ token: 'operator', foreground: 'a8a294' }, // quiet, near-foreground
			{ token: 'operator.sql', foreground: 'a8a294' },
			{ token: 'type', foreground: '92c4c4' }, // muted teal
			{ token: 'predefined', foreground: 'b1a6d4' }, // muted violet
			{ token: 'predefined.sql', foreground: 'b1a6d4' },
			{ token: 'identifier', foreground: 'c3c0b6' },
			{ token: 'delimiter', foreground: '8f8a7d' }
		],
		colors: {
			'editor.background': DARK.background,
			'editor.foreground': DARK.foreground,
			'editorCursor.foreground': DARK.foreground,
			'editor.lineHighlightBackground': '#2a2a27',
			'editor.selectionBackground': '#c5e3f626',
			'editor.inactiveSelectionBackground': '#c5e3f614',
			'editorLineNumber.foreground': DARK.mutedForeground,
			'editorLineNumber.activeForeground': DARK.accentForeground,
			'editorBracketMatch.background': '#ffffff26',
			'editorBracketMatch.border': DARK.ring,
			'editorSuggestWidget.background': DARK.popover,
			'editorSuggestWidget.foreground': DARK.popoverForeground,
			'editorSuggestWidget.border': DARK.border,
			'editorSuggestWidget.selectedBackground': DARK.accent,
			'editorSuggestWidget.selectedForeground': DARK.accentForeground,
			'editorWidget.background': DARK.popover,
			'editorWidget.border': DARK.border
		}
	});
}
