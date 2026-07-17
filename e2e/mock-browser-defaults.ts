import type { Page } from '@playwright/test';

export async function installMockBrowserDefaults(page: Page): Promise<void> {
	await page.addInitScript(() => {
		let downstreamWarn = console.warn.bind(console);
		const filteredWarn = (...args: unknown[]) => {
			const first = String(args[0] ?? '');
			// Stack-captured in the mocked chart flow: bits-ui can read a
			// now-destroyed Svelte derived while closing portaled layers during fast
			// Playwright interactions. This is upstream dev-mode noise in mocked
			// browser tests; keep all other warning classes visible.
			if (first.includes('[svelte] derived_inert')) return;
			downstreamWarn(...args);
		};
		Object.defineProperty(console, 'warn', {
			configurable: true,
			get() {
				return filteredWarn;
			},
			set(nextWarn: typeof console.warn) {
				downstreamWarn =
					typeof nextWarn === 'function' ? nextWarn.bind(console) : downstreamWarn;
			}
		});
		localStorage.clear();
		localStorage.setItem('lunapad_welcome_seen', '1');
		localStorage.setItem('lunapad.analytics.consent', 'declined');
	});
}
