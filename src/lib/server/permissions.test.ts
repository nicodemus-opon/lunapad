import { describe, expect, it } from 'vitest';
import { can, canResolveThread, normalizeRole, hasApiScope } from './permissions';

describe('permissions', () => {
	it('normalizes legacy user role to editor', () => {
		expect(normalizeRole('user')).toBe('editor');
		expect(normalizeRole(null)).toBe('editor');
	});

	it('grants admin full workspace write', () => {
		expect(can({ id: '1', role: 'admin' }, 'workspace:write')).toBe(true);
		expect(can({ id: '1', role: 'admin' }, 'shares:publish')).toBe(true);
	});

	it('blocks viewer from publishing shares', () => {
		expect(can({ id: '1', role: 'viewer' }, 'shares:publish')).toBe(false);
		expect(can({ id: '1', role: 'viewer' }, 'sites:manage')).toBe(false);
		expect(can({ id: '1', role: 'viewer' }, 'comments:write')).toBe(true);
	});

	it('grants editor sites manage', () => {
		expect(can({ id: '1', role: 'editor' }, 'sites:manage')).toBe(true);
	});

	it('blocks viewer from ai mutations', () => {
		expect(can({ id: '1', role: 'viewer' }, 'ai:mutate')).toBe(false);
		expect(can({ id: '1', role: 'viewer' }, 'ai:read')).toBe(true);
		expect(can({ id: '1', role: 'editor' }, 'ai:mutate')).toBe(true);
	});

	it('allows thread creator to resolve', () => {
		expect(
			canResolveThread({ id: 'u1', role: 'editor' }, { createdBy: 'u1', assigneeId: null })
		).toBe(true);
	});

	it('treats empty api scopes as full access', () => {
		expect(hasApiScope(null, 'workspace:write')).toBe(true);
		expect(hasApiScope(['workspace:read'], 'workspace:write')).toBe(false);
	});
});
