import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertAllowedProjectFolder, assertSafe } from './project';

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('project path safety', () => {
	it('allows folders under configured project roots', () => {
		const root = path.resolve('/tmp/lunapad-projects');
		vi.stubEnv('LUNAPAD_PROJECT_ROOTS', root);
		expect(() => assertAllowedProjectFolder(path.join(root, 'tenant-a', 'project'))).not.toThrow();
	});

	it('rejects folders outside configured project roots', () => {
		vi.stubEnv('LUNAPAD_PROJECT_ROOTS', path.resolve('/tmp/lunapad-projects'));
		expect(() => assertAllowedProjectFolder('/etc')).toThrow('configured project roots');
	});

	it('rejects nul bytes in folder input', () => {
		vi.stubEnv('LUNAPAD_PROJECT_ROOTS', path.resolve('/tmp/lunapad-projects'));
		expect(() => assertAllowedProjectFolder('/tmp/lunapad-projects/a\0b')).toThrow(
			'Project folder is required'
		);
	});

	it('assertSafe rejects targets outside their root', () => {
		expect(() => assertSafe('/tmp/root', '/tmp/root/sub/file.sql')).not.toThrow();
		expect(() => assertSafe('/tmp/root', '/tmp/root2/file.sql')).toThrow('outside');
	});
});
