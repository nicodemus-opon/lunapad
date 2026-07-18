// Applies a workspace brand theme (src/lib/types/theme.ts) at runtime by injecting
// a <style> override tag after layout.css — this only touches raw CSS custom
// property values, so Tailwind's @theme inline bridge, charts, and tables (all of
// which already resolve colors from these tokens) pick it up for free.
import { browser } from '$app/environment';
import { bumpThemeVersion } from './plotly-render.svelte';
import type { ThemeTokenMap, WorkspaceTheme } from '$lib/types/theme';
import { isDefaultTheme } from '$lib/types/theme';

const STYLE_TAG_ID = 'workspace-theme-override';
export const WORKSPACE_THEME_STORAGE_KEY = 'lunapad_workspace_theme';

let activeTheme = $state<WorkspaceTheme | null>(null);

export function getActiveWorkspaceTheme(): WorkspaceTheme | null {
	return activeTheme;
}

function tokenBlockCss(tokens: ThemeTokenMap): string {
	return Object.entries(tokens)
		.filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
		.map(([key, value]) => `${key}: ${value};`)
		.join(' ');
}

/** Builds the override stylesheet text for a theme — shared by the client-side
 *  injector below and by server-side callers (share-page SSR, static export). */
export function buildThemeOverrideCss(theme: WorkspaceTheme | null): string {
	if (!theme || isDefaultTheme(theme)) return '';
	const lightCss = tokenBlockCss(theme.light);
	const darkCss = tokenBlockCss(theme.dark);
	const parts: string[] = [];
	if (lightCss) parts.push(`:root { ${lightCss} }`);
	if (darkCss) parts.push(`.dark { ${darkCss} }`);
	return parts.join('\n');
}

/** Applies a workspace theme by writing/replacing a single override <style> tag
 *  in <head>. Safe to call repeatedly (e.g. live-preview while customizing). */
export function applyWorkspaceTheme(theme: WorkspaceTheme | null): void {
	if (!browser) return;
	activeTheme = theme;
	const css = buildThemeOverrideCss(theme);
	let styleEl = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
	if (!css) {
		styleEl?.remove();
		bumpThemeVersion();
		return;
	}
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = STYLE_TAG_ID;
	}
	if (styleEl.textContent !== css) styleEl.textContent = css;
	// app.html injects this before first paint, but framework CSS can be
	// appended later during dev/HMR or initial hydration. Re-append to keep the
	// workspace override last in the cascade.
	document.head.appendChild(styleEl);
	bumpThemeVersion();
}

export function cacheWorkspaceTheme(theme: WorkspaceTheme | null): void {
	if (!browser) return;
	try {
		if (theme && !isDefaultTheme(theme)) {
			localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, JSON.stringify(theme));
		} else {
			localStorage.removeItem(WORKSPACE_THEME_STORAGE_KEY);
		}
	} catch {
		// storage unavailable (private browsing, quota) — theme still applies for this session
	}
}

export function readCachedWorkspaceTheme(): WorkspaceTheme | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as WorkspaceTheme;
	} catch {
		return null;
	}
}

export type WorkspaceThemeFetchResult = { ok: true; theme: WorkspaceTheme | null } | { ok: false };

/** Back-compat wrapper for callers that only need the theme value. Use
 *  fetchWorkspaceThemeResult() when failed reads must be distinguished from a
 *  successful "no theme configured" response. */
export async function fetchWorkspaceTheme(): Promise<WorkspaceTheme | null> {
	const result = await fetchWorkspaceThemeResult();
	return result.ok ? result.theme : null;
}

/** Fetches the org's saved brand theme while distinguishing "the workspace has
 *  no theme" from "we could not ask the server". The distinction matters on
 *  reload: an auth/setup/network miss should not wipe the early-painted cached
 *  theme, but a successful `theme: null` response should. */
export async function fetchWorkspaceThemeResult(): Promise<WorkspaceThemeFetchResult> {
	if (!browser) return { ok: false };
	try {
		const res = await fetch('/api/orgs/current');
		if (!res.ok) return { ok: false };
		const body = await res.json();
		const theme = body?.organization?.theme as WorkspaceTheme | null | undefined;
		return { ok: true, theme: theme ?? null };
	} catch {
		return { ok: false };
	}
}

export async function saveWorkspaceTheme(
	orgId: string,
	theme: WorkspaceTheme | null
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await fetch(`/api/orgs/${orgId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ theme })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) return { ok: false, error: body.error ?? 'Failed to save theme.' };
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Failed to save theme.' };
	}
}
