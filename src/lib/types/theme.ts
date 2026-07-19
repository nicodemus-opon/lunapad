// Workspace brand-theme data model. A theme overrides a subset of the CSS custom
// properties defined in src/routes/layout.css — values are stored as raw CSS color
// strings (hex, oklch(), hsl()...) and applied verbatim, so presets pasted from an
// external shadcn/Tailwind theme tool (e.g. tweakcn.com) work without any color-space
// conversion.

export type ThemeTokenKey =
	| '--background'
	| '--foreground'
	| '--card'
	| '--card-foreground'
	| '--popover'
	| '--popover-foreground'
	| '--primary'
	| '--primary-foreground'
	| '--secondary'
	| '--secondary-foreground'
	| '--muted'
	| '--muted-foreground'
	| '--accent'
	| '--accent-foreground'
	| '--destructive'
	| '--destructive-foreground'
	| '--warning'
	| '--success'
	| '--border'
	| '--input'
	| '--ring'
	| '--chart-1'
	| '--chart-2'
	| '--chart-3'
	| '--chart-4'
	| '--chart-5'
	| '--sidebar'
	| '--sidebar-foreground'
	| '--sidebar-primary'
	| '--sidebar-primary-foreground'
	| '--sidebar-accent'
	| '--sidebar-accent-foreground'
	| '--sidebar-border'
	| '--sidebar-ring';

export type ThemeTokenMap = Partial<Record<ThemeTokenKey, string>>;

export interface WorkspaceTheme {
	id: string;
	name: string;
	light: ThemeTokenMap;
	dark: ThemeTokenMap;
}

/** The tokens exposed in the "Customize" editor — the ones with the most
 *  visible day-to-day impact. Everything else can still be set via paste-import. */
export const EDITABLE_THEME_TOKENS: { key: ThemeTokenKey; label: string }[] = [
	{ key: '--primary', label: 'Primary' },
	{ key: '--secondary', label: 'Secondary' },
	{ key: '--accent', label: 'Accent' },
	{ key: '--background', label: 'Background' },
	{ key: '--foreground', label: 'Text' },
	{ key: '--border', label: 'Border' },
	{ key: '--chart-1', label: 'Chart 1' },
	{ key: '--chart-2', label: 'Chart 2' },
	{ key: '--chart-3', label: 'Chart 3' },
	{ key: '--chart-4', label: 'Chart 4' },
	{ key: '--chart-5', label: 'Chart 5' }
];

export const ALL_THEME_TOKEN_KEYS: ThemeTokenKey[] = [
	'--background',
	'--foreground',
	'--card',
	'--card-foreground',
	'--popover',
	'--popover-foreground',
	'--primary',
	'--primary-foreground',
	'--secondary',
	'--secondary-foreground',
	'--muted',
	'--muted-foreground',
	'--accent',
	'--accent-foreground',
	'--destructive',
	'--destructive-foreground',
	'--warning',
	'--success',
	'--border',
	'--input',
	'--ring',
	'--chart-1',
	'--chart-2',
	'--chart-3',
	'--chart-4',
	'--chart-5',
	'--sidebar',
	'--sidebar-foreground',
	'--sidebar-primary',
	'--sidebar-primary-foreground',
	'--sidebar-accent',
	'--sidebar-accent-foreground',
	'--sidebar-border',
	'--sidebar-ring'
];

const TOKEN_KEY_SET = new Set<string>(ALL_THEME_TOKEN_KEYS);

/** `null` (not the empty-token "Default" preset id) means "no brand theme
 *  configured" — the app falls back to layout.css's built-in light/dark tokens. */
export const DEFAULT_THEME_ID = 'default';

/** Curated starting points, inspired by the shadcn/Tailwind theme gallery at
 *  tweakcn.com/community — a small set of moods rather than an exhaustive
 *  library, since "Paste theme CSS" covers anything beyond these directly. */
export const PRESET_THEMES: WorkspaceTheme[] = [
	{
		id: DEFAULT_THEME_ID,
		name: 'Default',
		light: {},
		dark: {}
	},
	{
		id: 'ocean',
		name: 'Ocean',
		light: {
			'--primary': '#2563eb',
			'--primary-foreground': '#ffffff',
			'--secondary': '#eff6ff',
			'--secondary-foreground': '#1e3a8a',
			'--accent': '#dbeafe',
			'--accent-foreground': '#1e3a8a',
			'--ring': '#93c5fd',
			'--chart-1': '#2563eb',
			'--chart-2': '#0ea5e9',
			'--chart-3': '#06b6d4',
			'--chart-4': '#6366f1',
			'--chart-5': '#8b5cf6',
			'--sidebar-primary': '#2563eb',
			'--sidebar-primary-foreground': '#ffffff',
			'--sidebar-accent': '#dbeafe',
			'--sidebar-accent-foreground': '#1e3a8a',
			'--sidebar-ring': '#93c5fd'
		},
		dark: {
			'--primary': '#60a5fa',
			'--primary-foreground': '#0b1220',
			'--secondary': '#1e293b',
			'--secondary-foreground': '#cbd5e1',
			'--accent': '#1e3a8a',
			'--accent-foreground': '#dbeafe',
			'--ring': '#3b82f6',
			'--chart-1': '#60a5fa',
			'--chart-2': '#38bdf8',
			'--chart-3': '#22d3ee',
			'--chart-4': '#818cf8',
			'--chart-5': '#a78bfa',
			'--sidebar-primary': '#60a5fa',
			'--sidebar-primary-foreground': '#0b1220',
			'--sidebar-accent': '#1e3a8a',
			'--sidebar-accent-foreground': '#dbeafe',
			'--sidebar-ring': '#3b82f6'
		}
	},
	{
		id: 'emerald',
		name: 'Emerald',
		light: {
			'--primary': '#059669',
			'--primary-foreground': '#ffffff',
			'--secondary': '#ecfdf5',
			'--secondary-foreground': '#065f46',
			'--accent': '#d1fae5',
			'--accent-foreground': '#065f46',
			'--ring': '#6ee7b7',
			'--chart-1': '#059669',
			'--chart-2': '#0d9488',
			'--chart-3': '#84cc16',
			'--chart-4': '#14b8a6',
			'--chart-5': '#22c55e',
			'--sidebar-primary': '#059669',
			'--sidebar-primary-foreground': '#ffffff',
			'--sidebar-accent': '#d1fae5',
			'--sidebar-accent-foreground': '#065f46',
			'--sidebar-ring': '#6ee7b7'
		},
		dark: {
			'--primary': '#34d399',
			'--primary-foreground': '#062017',
			'--secondary': '#134e3a',
			'--secondary-foreground': '#a7f3d0',
			'--accent': '#065f46',
			'--accent-foreground': '#d1fae5',
			'--ring': '#10b981',
			'--chart-1': '#34d399',
			'--chart-2': '#2dd4bf',
			'--chart-3': '#a3e635',
			'--chart-4': '#5eead4',
			'--chart-5': '#4ade80',
			'--sidebar-primary': '#34d399',
			'--sidebar-primary-foreground': '#062017',
			'--sidebar-accent': '#065f46',
			'--sidebar-accent-foreground': '#d1fae5',
			'--sidebar-ring': '#10b981'
		}
	},
	{
		id: 'sunset',
		name: 'Sunset',
		light: {
			'--primary': '#ea580c',
			'--primary-foreground': '#ffffff',
			'--secondary': '#fff7ed',
			'--secondary-foreground': '#7c2d12',
			'--accent': '#ffedd5',
			'--accent-foreground': '#7c2d12',
			'--ring': '#fdba74',
			'--chart-1': '#ea580c',
			'--chart-2': '#f59e0b',
			'--chart-3': '#dc2626',
			'--chart-4': '#d97706',
			'--chart-5': '#e11d48',
			'--sidebar-primary': '#ea580c',
			'--sidebar-primary-foreground': '#ffffff',
			'--sidebar-accent': '#ffedd5',
			'--sidebar-accent-foreground': '#7c2d12',
			'--sidebar-ring': '#fdba74'
		},
		dark: {
			'--primary': '#fb923c',
			'--primary-foreground': '#1f0e02',
			'--secondary': '#431407',
			'--secondary-foreground': '#fed7aa',
			'--accent': '#7c2d12',
			'--accent-foreground': '#ffedd5',
			'--ring': '#f97316',
			'--chart-1': '#fb923c',
			'--chart-2': '#fbbf24',
			'--chart-3': '#f87171',
			'--chart-4': '#fbbf24',
			'--chart-5': '#fb7185',
			'--sidebar-primary': '#fb923c',
			'--sidebar-primary-foreground': '#1f0e02',
			'--sidebar-accent': '#7c2d12',
			'--sidebar-accent-foreground': '#ffedd5',
			'--sidebar-ring': '#f97316'
		}
	},
	{
		id: 'slate',
		name: 'Slate',
		light: {
			'--primary': '#334155',
			'--primary-foreground': '#ffffff',
			'--secondary': '#f1f5f9',
			'--secondary-foreground': '#1e293b',
			'--accent': '#e2e8f0',
			'--accent-foreground': '#1e293b',
			'--ring': '#94a3b8',
			'--chart-1': '#334155',
			'--chart-2': '#64748b',
			'--chart-3': '#0f172a',
			'--chart-4': '#94a3b8',
			'--chart-5': '#475569',
			'--sidebar-primary': '#334155',
			'--sidebar-primary-foreground': '#ffffff',
			'--sidebar-accent': '#e2e8f0',
			'--sidebar-accent-foreground': '#1e293b',
			'--sidebar-ring': '#94a3b8'
		},
		dark: {
			'--primary': '#cbd5e1',
			'--primary-foreground': '#0f172a',
			'--secondary': '#1e293b',
			'--secondary-foreground': '#e2e8f0',
			'--accent': '#334155',
			'--accent-foreground': '#f1f5f9',
			'--ring': '#64748b',
			'--chart-1': '#cbd5e1',
			'--chart-2': '#94a3b8',
			'--chart-3': '#e2e8f0',
			'--chart-4': '#64748b',
			'--chart-5': '#f1f5f9',
			'--sidebar-primary': '#cbd5e1',
			'--sidebar-primary-foreground': '#0f172a',
			'--sidebar-accent': '#334155',
			'--sidebar-accent-foreground': '#f1f5f9',
			'--sidebar-ring': '#64748b'
		}
	},
	{
		id: 'nord',
		name: 'Nord',
		light: {
			'--primary': '#5e81ac',
			'--primary-foreground': '#eceff4',
			'--secondary': '#e5e9f0',
			'--secondary-foreground': '#2e3440',
			'--accent': '#d8dee9',
			'--accent-foreground': '#2e3440',
			'--ring': '#88c0d0',
			'--chart-1': '#5e81ac',
			'--chart-2': '#88c0d0',
			'--chart-3': '#a3be8c',
			'--chart-4': '#b48ead',
			'--chart-5': '#d08770',
			'--sidebar-primary': '#5e81ac',
			'--sidebar-primary-foreground': '#eceff4',
			'--sidebar-accent': '#d8dee9',
			'--sidebar-accent-foreground': '#2e3440',
			'--sidebar-ring': '#88c0d0'
		},
		dark: {
			'--primary': '#88c0d0',
			'--primary-foreground': '#2e3440',
			'--secondary': '#3b4252',
			'--secondary-foreground': '#e5e9f0',
			'--accent': '#434c5e',
			'--accent-foreground': '#eceff4',
			'--ring': '#81a1c1',
			'--background': '#2e3440',
			'--foreground': '#eceff4',
			'--card': '#3b4252',
			'--border': '#4c566a',
			'--chart-1': '#88c0d0',
			'--chart-2': '#81a1c1',
			'--chart-3': '#a3be8c',
			'--chart-4': '#b48ead',
			'--chart-5': '#d08770',
			'--sidebar-primary': '#88c0d0',
			'--sidebar-primary-foreground': '#2e3440',
			'--sidebar-accent': '#434c5e',
			'--sidebar-accent-foreground': '#eceff4',
			'--sidebar-ring': '#81a1c1'
		}
	}
];

export function findPresetTheme(id: string): WorkspaceTheme | undefined {
	return PRESET_THEMES.find((t) => t.id === id);
}

export function isEmptyThemeTokens(tokens: ThemeTokenMap): boolean {
	return Object.keys(tokens).length === 0;
}

export function isDefaultTheme(theme: WorkspaceTheme | null | undefined): boolean {
	if (!theme) return true;
	return isEmptyThemeTokens(theme.light) && isEmptyThemeTokens(theme.dark);
}

/** Parses a pasted CSS variables block (e.g. a tweakcn.com theme export, or any
 *  shadcn-style `:root { --token: value; } .dark { --token: value; }` snippet)
 *  into a WorkspaceTheme. Unrecognized tokens are silently dropped rather than
 *  erroring — pasted themes often carry tokens (fonts, radius, shadows) this app
 *  doesn't use for brand coloring. */
export function parseThemeCss(css: string, name = 'Custom'): WorkspaceTheme {
	const light: ThemeTokenMap = {};
	const dark: ThemeTokenMap = {};

	// Grab each top-level block's selector + body, e.g. ":root {...}" / ".dark {...}"
	const blockPattern = /([.:a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = blockPattern.exec(css))) {
		const selector = match[1].trim();
		const body = match[2];
		const isDark = /\.dark/.test(selector);
		const isLight = selector === ':root' || selector === 'html' || selector === ':host';
		if (!isDark && !isLight) continue;
		const target = isDark ? dark : light;
		const declPattern = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);?/g;
		let decl: RegExpExecArray | null;
		while ((decl = declPattern.exec(body))) {
			const key = decl[1].trim();
			if (!TOKEN_KEY_SET.has(key)) continue;
			target[key as ThemeTokenKey] = decl[2].trim();
		}
	}

	return {
		id: `custom-${Date.now()}`,
		name,
		light,
		dark
	};
}
