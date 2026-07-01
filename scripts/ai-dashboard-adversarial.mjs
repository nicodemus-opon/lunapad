#!/usr/bin/env node
/**
 * Adversarial dashboard AI integration tests (live LLM).
 * Requires NVAPI_KEY and a running dev server (LUNAPAD_URL).
 *
 * Usage:
 *   NVAPI_KEY=... LUNAPAD_URL=http://localhost:5199 node scripts/ai-dashboard-adversarial.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
	'pnpm',
	[
		'vitest',
		'run',
		'src/lib/agent/evals/dashboard-adversarial.test.ts',
		'src/lib/agent/evals/dashboard-adversarial.integration.test.ts'
	],
	{ cwd: root, stdio: 'inherit', env: process.env }
);
process.exit(result.status === null ? 1 : result.status);
