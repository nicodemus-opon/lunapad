#!/usr/bin/env node
/**
 * Adversarial dashboard AI integration tests (live LLM).
 * Requires a running dev server (LUNAPAD_URL). Uses local Ollama by default.
 *
 * Usage:
 *   LLM_PROVIDER=ollama LLM_BASE_URL=http://127.0.0.1:11434 LLM_MODEL=gemma4:12b-mlx LUNAPAD_URL=http://localhost:5199 node scripts/ai-dashboard-adversarial.mjs
 *   NVAPI_KEY=... LLM_PROVIDER=openapi-compatible LUNAPAD_URL=http://localhost:5199 node scripts/ai-dashboard-adversarial.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('pnpm', ['vitest', 'run', '--config', 'vitest.ai-dashboard.config.ts'], {
	cwd: root,
	stdio: 'inherit',
	env: process.env
});
process.exit(result.status === null ? 1 : result.status);
