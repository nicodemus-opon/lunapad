import { browser } from '$app/environment';

export type PlatformType = 'web' | 'tauri';
export type OSType = 'macos' | 'windows' | 'linux' | 'unknown';

export const platform: PlatformType =
	browser && '__TAURI_INTERNALS__' in window ? 'tauri' : 'web';

export const isDesktop = platform === 'tauri';

function detectOSSync(): OSType {
	if (!browser) return 'unknown';
	const p = navigator.platform.toLowerCase();
	const ua = navigator.userAgent.toLowerCase();
	if (p.includes('mac') || ua.includes('macintosh')) return 'macos';
	if (p.includes('win') || ua.includes('windows')) return 'windows';
	if (p.includes('linux') || ua.includes('linux')) return 'linux';
	return 'unknown';
}

// Seeded synchronously from navigator — no async needed for the common case
export const platformOS = $state({ value: browser ? detectOSSync() : ('unknown' as OSType) });

// Authoritative confirmation via Tauri plugin; overrides synchronous detection if different
export async function initPlatform(): Promise<void> {
	if (platform !== 'tauri') return;
	const { type } = await import('@tauri-apps/plugin-os');
	const detected = await type();
	if (detected === 'macos' || detected === 'windows' || detected === 'linux') {
		platformOS.value = detected as OSType;
	}
}
