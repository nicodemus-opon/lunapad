import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fakes just enough of `query()` to exercise the ephemeral-render-token fallback path
// without a real Postgres connection: internal_notebook_renders/_connections are backed
// by an in-memory array, and anything else (CREATE TABLE/ensureDefaultTenant/etc., all
// invoked inside ensureSharedReportTables()'s try/catch) throws — which that function
// already swallows as "Postgres not available", the same graceful-degradation path this
// code supports in demo mode. shared_reports itself always returns empty so getShareByToken
// falls through to the internal-render fallback under test.
interface FakeRow {
	[key: string]: unknown;
}
let renders: FakeRow[] = [];
let connections: FakeRow[] = [];

vi.mock('./db.js', () => ({
	query: vi.fn(async (sql: string, params: unknown[] = []) => {
		const s = sql.trim();
		if (/^SELECT \* FROM shared_reports WHERE token = \$1/i.test(s)) return [];
		if (/^INSERT INTO internal_notebook_renders/i.test(s)) {
			const [token, orgId, projectId, notebookId, notebookName, snapshot, theme, expiresAt] =
				params;
			renders.push({
				token,
				org_id: orgId,
				project_id: projectId,
				notebook_id: notebookId,
				notebook_name: notebookName,
				snapshot: JSON.parse(snapshot as string),
				theme,
				expires_at: expiresAt,
				created_at: new Date().toISOString()
			});
			return [];
		}
		if (/^INSERT INTO internal_notebook_render_connections/i.test(s)) {
			const [token, connectionId, connection, secret] = params;
			connections.push({
				token,
				connection_id: connectionId,
				connection: JSON.parse(connection as string),
				secret: secret ? JSON.parse(secret as string) : null
			});
			return [];
		}
		if (
			/^SELECT \* FROM internal_notebook_renders WHERE token = \$1 AND expires_at > NOW\(\)/i.test(
				s
			)
		) {
			const [token] = params;
			return renders.filter(
				(r) => r.token === token && new Date(r.expires_at as string) > new Date()
			);
		}
		if (
			/^SELECT connection_id, connection, secret FROM internal_notebook_render_connections WHERE token = \$1/i.test(
				s
			)
		) {
			const [token] = params;
			return connections.filter((r) => r.token === token);
		}
		if (/^DELETE FROM internal_notebook_renders WHERE token = \$1/i.test(s)) {
			const [token] = params;
			renders = renders.filter((r) => r.token !== token);
			return [];
		}
		throw new Error('Postgres not available (mock)');
	})
}));

beforeEach(() => {
	renders = [];
	connections = [];
	vi.resetModules();
});

describe('ephemeral render-share fallback', () => {
	it('createInternalRenderShare → getShareByToken resolves a synthetic, non-auth-required record', async () => {
		const { createInternalRenderShare, getShareByToken } = await import('./shared-reports.js');
		const { token } = await createInternalRenderShare({
			notebookId: 'nb1',
			notebookName: 'Demo notebook',
			snapshot: { cells: [], reportView: true },
			connections: [
				{
					connectionId: 'conn1',
					connection: { id: 'conn1', type: 'postgres' } as never,
					secret: null
				}
			]
		});

		const share = await getShareByToken(token);
		expect(share).not.toBeNull();
		expect(share?.notebookId).toBe('nb1');
		expect(share?.notebookName).toBe('Demo notebook');
		expect(share?.requireAuth).toBe(false);
		expect(share?.revoked).toBe(false);
		expect(share?.slug).toBeNull();
	});

	it('getShareConnections falls back to the internal render connections', async () => {
		const { createInternalRenderShare, getShareConnections } = await import('./shared-reports.js');
		const { token } = await createInternalRenderShare({
			notebookId: 'nb1',
			notebookName: 'Demo notebook',
			snapshot: { cells: [], reportView: true },
			connections: [
				{
					connectionId: 'conn1',
					connection: { id: 'conn1', type: 'postgres' } as never,
					secret: null
				}
			]
		});

		const conns = await getShareConnections(token);
		expect(conns).toHaveLength(1);
		expect(conns[0].connectionId).toBe('conn1');
	});

	it('deleteInternalRenderShare removes the token so getShareByToken returns null', async () => {
		const { createInternalRenderShare, deleteInternalRenderShare, getShareByToken } =
			await import('./shared-reports.js');
		const { token } = await createInternalRenderShare({
			notebookId: 'nb1',
			notebookName: 'Demo notebook',
			snapshot: { cells: [], reportView: true },
			connections: []
		});

		await deleteInternalRenderShare(token);
		expect(await getShareByToken(token)).toBeNull();
	});
});
