import { defineConfig, devices } from '@playwright/test';

// Two test tiers:
//  • `mocked`  — fast, deterministic UI tests that stub /api/ai/chat (no LLM). Default.
//                Files: e2e/*.mock.spec.ts.
//  • `llm`     — real-Ollama smoke tests that auto-skip when Ollama is unreachable.
//                Files: e2e/*.llm.spec.ts.
//
// Note: the dev server binds IPv6 only, so reach it via `localhost` (resolves to ::1),
// not `127.0.0.1` (IPv4 — won't connect).
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	projects: [
		{
			name: 'mocked',
			testMatch: /\.mock\.spec\.ts$/,
			use: { ...devices['Desktop Chrome'] },
			timeout: 30_000,
			expect: { timeout: 10_000 }
		},
		{
			name: 'llm',
			testMatch: /\.llm\.spec\.ts$/,
			use: { ...devices['Desktop Chrome'] },
			timeout: 300_000,
			expect: { timeout: 120_000 }
		}
	],
	...(process.env.PLAYWRIGHT_BASE_URL
		? {}
		: {
				webServer: {
					command: 'pnpm dev',
					url: baseURL,
					reuseExistingServer: true,
					timeout: 60_000,
					// e2e specs have no login flow — bypass auth gating for the test server only.
					// hooks.server.ts refuses to start with this combined with NODE_ENV=production.
					env: { DISABLE_AUTH: '1' }
				}
			})
});
