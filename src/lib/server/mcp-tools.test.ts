import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLunapadMcpServer, type McpAuthContext } from './mcp-tools.js';

/**
 * Exercises createLunapadMcpServer through the real MCP client/server protocol
 * (in-memory transport, no HTTP) — this is what the DISABLE_AUTH dev config
 * CANNOT test live, since DISABLE_AUTH short-circuits hooks.server.ts before
 * the Authorization: Bearer header is ever inspected (every request becomes a
 * synthetic full-access admin session regardless of what key is presented).
 * Manual curl testing against `pnpm dev --port 5181` (dev-full) caught the
 * first version of this bug (session-cookie users getting scope-blocked); this
 * suite is what caught the second one (API-key scope checks appearing to pass
 * when they were actually never being exercised at all under that dev mode).
 */
async function connectedClient(auth: McpAuthContext): Promise<Client> {
	const server = createLunapadMcpServer(auth);
	const client = new Client({ name: 'test-client', version: '1.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-mcp-tools-test-'));
	await fs.mkdir(path.join(dir, 'models'), { recursive: true });
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

const admin: McpAuthContext['user'] = { id: 'u1', role: 'admin' };

describe('createLunapadMcpServer permission gating', () => {
	it('registers the agent-first composition and visual grammar tools', async () => {
		const client = await connectedClient({
			user: admin,
			apiKeyId: 'key0',
			apiKeyScopes: ['workspace:read', 'workspace:write', 'connections:query']
		});
		const tools = await client.listTools();
		const names = new Set(tools.tools.map((tool) => tool.name));
		expect([...names]).toEqual(
			expect.arrayContaining([
				'list_capabilities',
				'get_visual_report_grammar',
				'get_component_capabilities',
				'get_notebook_app_grammar',
				'plan_notebook_app',
				'repair_notebook_blueprint',
				'score_notebook_blueprint',
				'inspect_resource',
				'discover_schema',
				'validate_workflow',
				'run_workflow',
				'delete_resource'
			])
		);
	});

	it('allows a workspace:write-scoped API key to call create_notebook', async () => {
		const client = await connectedClient({
			user: admin,
			apiKeyId: 'key1',
			apiKeyScopes: ['workspace:write']
		});
		const result = await client.callTool({
			name: 'create_notebook',
			arguments: { folder: dir, notebookId: 'models/a', blocks: [{ type: 'text', content: 'x' }] }
		});
		expect(result.isError).toBeFalsy();
	});

	it('rejects a workspace:read-only-scoped API key from calling create_notebook', async () => {
		const client = await connectedClient({
			user: admin,
			apiKeyId: 'key2',
			apiKeyScopes: ['workspace:read']
		});
		const result = await client.callTool({
			name: 'create_notebook',
			arguments: { folder: dir, notebookId: 'models/b', blocks: [{ type: 'text', content: 'x' }] }
		});
		expect(result.isError).toBe(true);
		expect((result.content as Array<{ text: string }>)[0].text).toMatch(/forbidden/i);
		await expect(fs.access(path.join(dir, 'models/b.luna'))).rejects.toThrow();
	});

	it('rejects an unscoped (no explicit scopes) API key from calling create_notebook — the read-only default', async () => {
		const client = await connectedClient({ user: admin, apiKeyId: 'key3', apiKeyScopes: null });
		const result = await client.callTool({
			name: 'create_notebook',
			arguments: { folder: dir, notebookId: 'models/c', blocks: [{ type: 'text', content: 'x' }] }
		});
		expect(result.isError).toBe(true);
	});

	it('allows a session-cookie caller (apiKeyId null) through on role alone, even with apiKeyScopes null', async () => {
		// This is the exact shape a real logged-in browser session has: no API key was
		// ever presented, so apiKeyScopes is null too — but that must NOT be treated as
		// "unscoped API key, default to read-only". Regression test for the bug where
		// hasApiScope(null, action) was called unconditionally instead of being gated on
		// apiKeyId being present.
		const client = await connectedClient({ user: admin, apiKeyId: null, apiKeyScopes: null });
		const result = await client.callTool({
			name: 'create_notebook',
			arguments: { folder: dir, notebookId: 'models/d', blocks: [{ type: 'text', content: 'x' }] }
		});
		expect(result.isError).toBeFalsy();
		await expect(fs.access(path.join(dir, 'models/d.luna'))).resolves.toBeUndefined();
	});

	it('rejects a non-admin role even with full API-key scopes (role is checked first)', async () => {
		const client = await connectedClient({
			user: { id: 'u2', role: 'viewer' },
			apiKeyId: 'key4',
			apiKeyScopes: ['automation:full']
		});
		const result = await client.callTool({
			name: 'create_notebook',
			arguments: { folder: dir, notebookId: 'models/e', blocks: [{ type: 'text', content: 'x' }] }
		});
		expect(result.isError).toBe(true);
	});

	it('allows read-only tools (list_notebooks) for a workspace:read-scoped key', async () => {
		const client = await connectedClient({
			user: admin,
			apiKeyId: 'key5',
			apiKeyScopes: ['workspace:read']
		});
		const result = await client.callTool({ name: 'list_notebooks', arguments: { folder: dir } });
		expect(result.isError).toBeFalsy();
	});
});
