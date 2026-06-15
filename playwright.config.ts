import { defineConfig, devices } from '@playwright/test';

// Two test tiers:
//  • `mocked`  — fast, deterministic UI tests that stub /api/ai/chat (no LLM). Default.
//                Files: e2e/*.mock.spec.ts.
//  • `llm`     — real-Ollama smoke tests that auto-skip when Ollama is unreachable.
//                Files: e2e/*.llm.spec.ts.
//
// Note: the dev server binds IPv6 only, so reach it via `localhost` (resolves to ::1),
// not `127.0.0.1` (IPv4 — won't connect).
export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:5173',
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
	webServer: {
		command: 'pnpm dev',
		url: 'http://localhost:5173',
		reuseExistingServer: true,
		timeout: 60_000
	}
});
