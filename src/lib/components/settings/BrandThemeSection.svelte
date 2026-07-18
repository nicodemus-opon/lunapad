<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { toast } from 'svelte-sonner';
	import { ChevronRight, Check, Paintbrush, ClipboardPaste } from '@lucide/svelte';
	import { isServerWorkspaceMode } from '$lib/stores/notebook.svelte';
	import { oklchToRgb } from '$lib/utils/theme-colors';
	import {
		applyWorkspaceTheme,
		cacheWorkspaceTheme,
		saveWorkspaceTheme
	} from '$lib/services/workspace-theme.svelte';
	import {
		PRESET_THEMES,
		EDITABLE_THEME_TOKENS,
		DEFAULT_THEME_ID,
		findPresetTheme,
		parseThemeCss,
		isDefaultTheme,
		type WorkspaceTheme,
		type ThemeTokenMap,
		type ThemeTokenKey
	} from '$lib/types/theme';

	type CurrentOrg = {
		organization: { id: string; name: string; theme?: WorkspaceTheme | null };
		membership: { role: 'admin' | 'editor' | 'viewer' };
	};

	let current = $state<CurrentOrg | null>(null);
	let loading = $state(true);
	let activeTheme = $state<WorkspaceTheme>(PRESET_THEMES[0]);
	let customizeOpen = $state(false);
	let importOpen = $state(false);
	let importText = $state('');
	let saving = $state(false);
	let saveDebounce: ReturnType<typeof setTimeout> | undefined;
	let persistQueuedTheme: WorkspaceTheme | undefined;
	let persistInFlight = false;
	let destroyed = false;

	const isAdmin = $derived(current?.membership.role === 'admin');
	const isPreset = $derived(Boolean(findPresetTheme(activeTheme.id)));

	const DEFAULT_PICKER_TOKEN_COLORS: Record<
		'light' | 'dark',
		Partial<Record<ThemeTokenKey, string>>
	> = {
		light: {
			'--primary': 'oklch(0.704 0.04 256.788)',
			'--secondary': 'oklch(0.869 0.022 252.894)',
			'--accent': 'oklch(0.9245 0.0138 92.9892)',
			'--background': 'oklch(0.9818 0.0054 95.0986)',
			'--foreground': 'oklch(0.145 0 0)',
			'--border': 'oklch(0.869 0.005 56.366)',
			'--chart-1': 'oklch(0.809 0.105 251.813)',
			'--chart-2': 'oklch(0.811 0.111 293.571)',
			'--chart-3': 'oklch(0.8816 0.0276 93.128)',
			'--chart-4': 'oklch(0.704 0.04 256.788)',
			'--chart-5': 'oklch(0.588 0.158 241.966)'
		},
		dark: {
			'--primary': 'oklch(0.901 0.058 230.902)',
			'--secondary': 'oklch(0.9818 0.0054 95.0986)',
			'--accent': 'oklch(0.213 0.0078 95.4245)',
			'--background': 'oklch(0.2679 0.0036 106.6427)',
			'--foreground': 'oklch(0.8074 0.0142 93.0137)',
			'--border': 'oklch(0.3618 0.0101 106.8928)',
			'--chart-1': 'oklch(0.746 0.16 232.661)',
			'--chart-2': 'oklch(0.811 0.111 293.571)',
			'--chart-3': 'oklch(0.923 0.003 48.717)',
			'--chart-4': 'oklch(0.554 0.046 257.417)',
			'--chart-5': 'oklch(0.956 0.045 203.388)'
		}
	};

	async function load() {
		if (!isServerWorkspaceMode()) {
			loading = false;
			return;
		}
		loading = true;
		try {
			const res = await fetch('/api/orgs/current');
			if (!res.ok) return;
			current = (await res.json()) as CurrentOrg;
			const theme = current.organization.theme;
			activeTheme = theme && !isDefaultTheme(theme) ? theme : PRESET_THEMES[0];
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function applyLocally(theme: WorkspaceTheme): void {
		activeTheme = theme;
		applyWorkspaceTheme(isDefaultTheme(theme) ? null : theme);
		cacheWorkspaceTheme(isDefaultTheme(theme) ? null : theme);
	}

	function persist(theme: WorkspaceTheme): void {
		if (!current || !isAdmin || destroyed) return;
		persistQueuedTheme = theme;
		void drainPersistQueue();
	}

	async function drainPersistQueue(): Promise<void> {
		if (persistInFlight || !current || destroyed) return;
		persistInFlight = true;
		saving = true;
		try {
			while (persistQueuedTheme && !destroyed) {
				const theme = persistQueuedTheme;
				persistQueuedTheme = undefined;
				const result = await saveWorkspaceTheme(
					current.organization.id,
					isDefaultTheme(theme) ? null : theme
				);
				if (!result.ok) {
					toast.error(result.error ?? 'Failed to save brand theme.');
					continue;
				}
				if (!persistQueuedTheme) {
					toast.success(
						theme.id === DEFAULT_THEME_ID ? 'Brand theme reset.' : `${theme.name} applied.`
					);
				}
			}
		} finally {
			persistInFlight = false;
			saving = Boolean(persistQueuedTheme);
			if (persistQueuedTheme && !destroyed) {
				void drainPersistQueue();
			}
		}
	}

	function clearPendingSave(): void {
		if (saveDebounce) clearTimeout(saveDebounce);
		saveDebounce = undefined;
	}

	onDestroy(() => {
		destroyed = true;
		clearPendingSave();
		persistQueuedTheme = undefined;
	});

	function selectPreset(theme: WorkspaceTheme): void {
		if (!isAdmin) return;
		clearPendingSave();
		applyLocally(theme);
		persist(theme);
	}

	function updateToken(mode: 'light' | 'dark', key: string, value: string): void {
		if (!isAdmin) return;
		const next: WorkspaceTheme = {
			id: isPreset ? `custom-${Date.now()}` : activeTheme.id,
			name: isPreset ? 'Custom' : activeTheme.name,
			light: { ...activeTheme.light },
			dark: { ...activeTheme.dark }
		};
		(next[mode] as ThemeTokenMap)[key as keyof ThemeTokenMap] = value;
		applyLocally(next);
		if (saveDebounce) clearTimeout(saveDebounce);
		saveDebounce = setTimeout(() => persist(next), 300);
	}

	// CSS color -> #rrggbb — <input type="color"> only accepts hex, while
	// workspace themes can store OKLCH/HSL/rgb and inherited CSS variables.
	function rgbToHex(rgb: string): string {
		const oklch = rgb.match(/^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)/);
		if (oklch) {
			const lightness = Number(oklch[1]) / (oklch[2] ? 100 : 1);
			return rgbToHex(oklchToRgb(lightness, Number(oklch[3]), Number(oklch[4])));
		}
		if (!rgb.trim().startsWith('rgb')) return '#000000';
		const channels = rgb.match(/[\d.]+/g)?.slice(0, 3);
		if (!channels || channels.length < 3) return '#000000';
		const hex = (n: string) =>
			Math.max(0, Math.min(255, Math.round(Number(n))))
				.toString(16)
				.padStart(2, '0');
		return `#${hex(channels[0])}${hex(channels[1])}${hex(channels[2])}`;
	}

	function cssColorToHex(color: string): string {
		const trimmed = color.trim();
		const shortHex = trimmed.match(/^#([0-9a-f]{3})$/i);
		if (shortHex) {
			return `#${shortHex[1]
				.split('')
				.map((ch) => ch + ch)
				.join('')}`;
		}
		if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
		if (typeof document === 'undefined') return '#000000';
		const probe = document.createElement('div');
		probe.style.color = trimmed;
		if (!probe.style.color) return '#000000';
		probe.style.cssText += ';position:fixed;left:-9999px;top:-9999px;visibility:hidden';
		document.body.appendChild(probe);
		const resolved = getComputedStyle(probe).color;
		probe.remove();
		return rgbToHex(resolved);
	}

	// A token the active theme doesn't override still has a real rendered
	// color (layout.css's default) — show that in the picker instead of a
	// misleading black square, so "unset" doesn't look like "set to black".
	function tokenValue(mode: 'light' | 'dark', key: string): string {
		const explicit = (activeTheme[mode] as Record<string, string | undefined>)[key];
		if (explicit) return cssColorToHex(explicit);
		const defaultColor = DEFAULT_PICKER_TOKEN_COLORS[mode][key as ThemeTokenKey];
		return defaultColor ? cssColorToHex(defaultColor) : '#000000';
	}

	function applyImport(): void {
		if (!isAdmin || !importText.trim()) return;
		const parsed = parseThemeCss(importText, 'Imported');
		if (Object.keys(parsed.light).length === 0 && Object.keys(parsed.dark).length === 0) {
			toast.error('No recognizable theme tokens found in that CSS.');
			return;
		}
		clearPendingSave();
		applyLocally(parsed);
		persist(parsed);
		importText = '';
		importOpen = false;
		toast.success('Theme imported.');
	}

	function swatchStyle(theme: WorkspaceTheme): string {
		const primary = theme.light['--primary'] ?? 'var(--primary)';
		const c1 = theme.light['--chart-1'] ?? 'var(--chart-1)';
		const c2 = theme.light['--chart-2'] ?? 'var(--chart-2)';
		return `background: conic-gradient(${primary} 0 33%, ${c1} 33% 66%, ${c2} 66% 100%);`;
	}
</script>

{#if isServerWorkspaceMode() && !loading}
	<div class="space-y-3 border-t border-border pt-4">
		<div>
			<h2 class="text-sm font-semibold">Brand theme</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				Recolors notebooks, charts, and shared reports to match your company's colors.
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			{#each PRESET_THEMES as theme (theme.id)}
				<button
					type="button"
					class="group relative h-7 w-7 rounded-full border border-border transition-transform disabled:cursor-not-allowed"
					style={swatchStyle(theme)}
					disabled={!isAdmin}
					title={theme.name}
					aria-label={`Use ${theme.name} theme`}
					aria-pressed={activeTheme.id === theme.id}
					onclick={() => selectPreset(theme)}
				>
					{#if activeTheme.id === theme.id}
						<span
							class="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background text-foreground ring-1 ring-border"
						>
							<Check class="h-2.5 w-2.5" />
						</span>
					{/if}
				</button>
			{/each}
			{#if !isPreset}
				<span
					class="flex h-7 items-center rounded-full border border-dashed border-border px-2 text-2xs text-muted-foreground"
				>
					Custom
				</span>
			{/if}
			{#if saving}
				<span class="text-2xs text-muted-foreground">Saving…</span>
			{/if}
		</div>

		{#if !isAdmin}
			<p class="text-xs text-muted-foreground">Only workspace admins can change the brand theme.</p>
		{:else}
			<div class="space-y-1.5">
				<Collapsible.Root bind:open={customizeOpen}>
					<Collapsible.Trigger
						class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						<ChevronRight class="h-3 w-3 transition-transform {customizeOpen ? 'rotate-90' : ''}" />
						<Paintbrush class="h-3 w-3" /> Customize
					</Collapsible.Trigger>
					<Collapsible.Content>
						<div
							class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border p-3 sm:grid-cols-3"
						>
							{#each EDITABLE_THEME_TOKENS as token (token.key)}
								<div class="space-y-1">
									<p class="text-2xs text-muted-foreground">{token.label}</p>
									<div class="flex items-center gap-1.5">
										<span
											class="text-2xs text-muted-foreground/70"
											title="Light mode"
											aria-hidden="true">L</span
										>
										<input
											type="color"
											aria-label={`${token.label} (light mode)`}
											class="h-6 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
											value={tokenValue('light', token.key) || '#000000'}
											oninput={(e) =>
												updateToken(
													'light',
													token.key,
													(e.currentTarget as HTMLInputElement).value
												)}
										/>
										<span
											class="text-2xs text-muted-foreground/70"
											title="Dark mode"
											aria-hidden="true">D</span
										>
										<input
											type="color"
											aria-label={`${token.label} (dark mode)`}
											class="h-6 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
											value={tokenValue('dark', token.key) || '#000000'}
											oninput={(e) =>
												updateToken('dark', token.key, (e.currentTarget as HTMLInputElement).value)}
										/>
									</div>
								</div>
							{/each}
						</div>
					</Collapsible.Content>
				</Collapsible.Root>

				<Collapsible.Root bind:open={importOpen}>
					<Collapsible.Trigger
						class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						<ChevronRight class="h-3 w-3 transition-transform {importOpen ? 'rotate-90' : ''}" />
						<ClipboardPaste class="h-3 w-3" /> Paste theme CSS
					</Collapsible.Trigger>
					<Collapsible.Content>
						<div class="mt-2 space-y-2 rounded-md border border-border p-3">
							<p class="text-2xs text-muted-foreground">
								Paste a theme's CSS variables — e.g. exported from
								<a
									href="https://tweakcn.com/community"
									target="_blank"
									rel="noreferrer"
									class="underline">tweakcn.com/community</a
								>. Unrecognized tokens are ignored.
							</p>
							<Textarea
								class="h-24 font-mono text-2xs"
								placeholder={':root { --primary: oklch(...); } .dark { --primary: oklch(...); }'}
								bind:value={importText}
							/>
							<Button size="sm" class="h-7 text-xs" onclick={applyImport}>Apply</Button>
						</div>
					</Collapsible.Content>
				</Collapsible.Root>
			</div>
		{/if}
	</div>
{/if}
