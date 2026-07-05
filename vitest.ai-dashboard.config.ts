import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: [
			'src/lib/agent/evals/dashboard-adversarial.test.ts',
			'src/lib/agent/evals/dashboard-adversarial.integration.test.ts'
		],
		exclude: ['e2e/**']
	}
});
