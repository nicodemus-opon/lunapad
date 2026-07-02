import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const demoPort = process.env.DEMO_VIDEO_PORT ?? '5894';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${demoPort}`;
const artifactsDir = path.resolve('artifacts/demo-videos');

export default defineConfig({
	testDir: './scripts/demo-video',
	testMatch: /\.spec\.ts$/,
	fullyParallel: false,
	workers: 1,
	reporter: 'list',
	timeout: 900_000,
	use: {
		baseURL,
		...devices['Desktop Chrome'],
		viewport: { width: 1920, height: 1080 },
		video: { mode: 'on', size: { width: 1920, height: 1080 } },
		launchOptions: {
			args: ['--disable-dev-shm-usage']
		},
		trace: 'off'
	},
	webServer: {
		command: `pnpm exec vite dev --host localhost --port ${demoPort}`,
		url: baseURL,
		reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1',
		timeout: 120_000,
		env: {
			DISABLE_AUTH: '1'
		}
	},
	outputDir: artifactsDir
});
