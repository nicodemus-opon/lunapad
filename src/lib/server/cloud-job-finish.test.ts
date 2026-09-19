import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	finishPayloadShape,
	isFinalCloudJobStatus,
	resolveFinishResult
} from './cloud-job-finish.js';
import type { CloudJobStatus } from './cloud-jobs.js';

describe('isFinalCloudJobStatus', () => {
	it.each(['succeeded', 'failed', 'timed_out', 'cancelled'] as const)('accepts %s', (status) => {
		expect(isFinalCloudJobStatus(status)).toBe(true);
	});

	it.each(['queued', 'running', 'success', 'error', '', undefined] as (
		| CloudJobStatus
		| undefined
	)[])('rejects %s', (status) => {
		expect(isFinalCloudJobStatus(status)).toBe(false);
	});
});

describe('finishPayloadShape', () => {
	it('maps keys to type names without leaking values', () => {
		expect(
			finishPayloadShape({ status: 'succeeded', result: { rows: [[1]] }, tags: ['a'] })
		).toEqual({ status: 'string', result: 'object', tags: 'array' });
	});
});

describe('resolveFinishResult', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	const MISSING: unique symbol = Symbol('missing');

	function makeRoot(withFile: unknown | typeof MISSING = MISSING): {
		root: string;
		pointer: string;
	} {
		const root = mkdtempSync(path.join(tmpdir(), 'job-finish-'));
		dirs.push(root);
		const scratch = path.join(root, '.worker-scratch', 'org', 'job');
		mkdirSync(scratch, { recursive: true });
		const pointer = path.join(scratch, 'result.json');
		if (withFile !== MISSING) writeFileSync(pointer, JSON.stringify(withFile));
		return { root, pointer };
	}

	it('prefers the inline result when present', async () => {
		const { root } = makeRoot({ rows: [] });
		const resolved = await resolveFinishResult({
			result: { inline: true },
			resultPointer: path.join(root, '.worker-scratch', 'org', 'job', 'result.json'),
			projectsRoot: root
		});
		expect(resolved).toEqual({ result: { inline: true }, fileBytes: null, error: null });
	});

	it('preserves undefined when neither result nor pointer is sent', async () => {
		const { root } = makeRoot();
		const resolved = await resolveFinishResult({ result: undefined, projectsRoot: root });
		expect(resolved.error).toBeNull();
		expect(resolved.result).toBeUndefined();
	});

	it('loads large results from the pointer file', async () => {
		const { root, pointer } = makeRoot({ rows: [[1, 2, 3]] });
		const resolved = await resolveFinishResult({
			result: undefined,
			resultPointer: pointer,
			projectsRoot: root
		});
		expect(resolved.error).toBeNull();
		expect(resolved.result).toEqual({ rows: [[1, 2, 3]] });
		expect(typeof resolved.fileBytes).toBe('number');
	});

	it('rejects pointers escaping the scratch dir', async () => {
		const { root } = makeRoot();
		const outside = path.join(root, 'projects', 'org', 'real.json');
		mkdirSync(path.dirname(outside), { recursive: true });
		writeFileSync(outside, '{"rows":[]}');
		const resolved = await resolveFinishResult({
			result: undefined,
			resultPointer: outside,
			projectsRoot: root
		});
		expect(resolved.result).toBeNull();
		expect(resolved.error).toMatch(/escapes/);
	});

	it('rejects dot-dot traversal into projects', async () => {
		const { root } = makeRoot();
		const traversal = path.join(root, '.worker-scratch', '..', 'projects', 'x.json');
		const resolved = await resolveFinishResult({
			result: undefined,
			resultPointer: traversal,
			projectsRoot: root
		});
		expect(resolved.error).toMatch(/escapes/);
	});

	it('reports missing pointer files loudly', async () => {
		const { root, pointer } = makeRoot();
		const resolved = await resolveFinishResult({
			result: undefined,
			resultPointer: pointer,
			projectsRoot: root
		});
		expect(resolved.result).toBeNull();
		expect(resolved.error).toMatch(/not found/);
	});
});
