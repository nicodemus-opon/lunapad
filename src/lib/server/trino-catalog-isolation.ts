import crypto from 'node:crypto';
import type { Connection, DuckDBWASMConnection } from '$lib/types/connection';

export type ExternalConnection = Exclude<Connection, DuckDBWASMConnection>;

const PHYSICAL_PREFIX = 'lp_';

function shortHash(input: string): string {
	return crypto.createHash('sha256').update(input).digest('hex').slice(0, 14);
}

export function tenantTrinoUser(orgId?: string | null): string {
	if (!orgId) return 'lunapad';
	return `org_${shortHash(orgId).slice(0, 16)}`;
}

export function physicalCatalogNameFor(orgId: string, connectionId: string): string {
	return `${physicalCatalogPrefixFor(orgId)}${shortHash(connectionId)}`;
}

export function physicalCatalogPrefixFor(orgId: string): string {
	return `${PHYSICAL_PREFIX}${shortHash(orgId)}_`;
}

export function isPhysicalCatalogName(name: string): boolean {
	return name.toLowerCase().startsWith(PHYSICAL_PREFIX);
}

export function withPhysicalCatalog<T extends Connection>(connection: T, orgId?: string | null): T {
	if (connection.type === 'duckdb-wasm' || !orgId) return connection;
	const physicalCatalogName =
		connection.physicalCatalogName ?? physicalCatalogNameFor(orgId, connection.id);
	return ({ ...connection, physicalCatalogName } satisfies Connection) as T;
}

export function forTrino<T extends Connection>(connection: T, orgId?: string | null): T {
	const isolated = withPhysicalCatalog(connection, orgId);
	if (isolated.type === 'duckdb-wasm' || !orgId) return isolated;
	return ({ ...isolated, catalogName: isolated.physicalCatalogName! } satisfies Connection) as T;
}

export function publicConnection<T extends Connection>(connection: T): T {
	if (!('physicalCatalogName' in connection)) return connection;
	const { physicalCatalogName: _physicalCatalogName, ...rest } = connection;
	return rest as T;
}

export function publicConnections<T extends Connection>(connections: T[]): T[] {
	return connections.map(publicConnection);
}

function parseIdentifier(sql: string, start: number): { raw: string; name: string; end: number } | null {
	const first = sql[start];
	if (first === '"') {
		let i = start + 1;
		let name = '';
		while (i < sql.length) {
			const ch = sql[i];
			if (ch === '"' && sql[i + 1] === '"') {
				name += '"';
				i += 2;
				continue;
			}
			if (ch === '"') return { raw: sql.slice(start, i + 1), name, end: i + 1 };
			name += ch;
			i++;
		}
		return null;
	}
	if (!/[A-Za-z_]/.test(first)) return null;
	let i = start + 1;
	while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i])) i++;
	return { raw: sql.slice(start, i), name: sql.slice(start, i), end: i };
}

function skipSpace(sql: string, start: number): number {
	let i = start;
	while (i < sql.length && /\s/.test(sql[i])) i++;
	return i;
}

function hasThreePartReference(sql: string, firstEnd: number): boolean {
	let i = skipSpace(sql, firstEnd);
	if (sql[i] !== '.') return false;
	const second = parseIdentifier(sql, skipSpace(sql, i + 1));
	if (!second) return false;
	i = skipSpace(sql, second.end);
	return sql[i] === '.';
}

export function rewriteTenantCatalogReferences(
	sql: string,
	orgId: string | undefined | null,
	connections: Connection[]
): string {
	if (!orgId) return sql;
	const aliases = new Map<string, string>();
	for (const connection of connections) {
		if (connection.type === 'duckdb-wasm') continue;
		const physicalCatalogName =
			connection.physicalCatalogName ?? physicalCatalogNameFor(orgId, connection.id);
		aliases.set(connection.catalogName.toLowerCase(), physicalCatalogName);
	}
	if (aliases.size === 0) return sql;

	let out = '';
	let i = 0;
	while (i < sql.length) {
		const ch = sql[i];
		if (ch === "'") {
			const start = i++;
			while (i < sql.length) {
				if (sql[i] === "'" && sql[i + 1] === "'") {
					i += 2;
					continue;
				}
				if (sql[i++] === "'") break;
			}
			out += sql.slice(start, i);
			continue;
		}
		if (ch === '-' && sql[i + 1] === '-') {
			const start = i;
			i += 2;
			while (i < sql.length && sql[i] !== '\n') i++;
			out += sql.slice(start, i);
			continue;
		}
		if (ch === '/' && sql[i + 1] === '*') {
			const start = i;
			i += 2;
			while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
			i = Math.min(sql.length, i + 2);
			out += sql.slice(start, i);
			continue;
		}

		const ident = parseIdentifier(sql, i);
		if (!ident) {
			out += ch;
			i++;
			continue;
		}
		if (!hasThreePartReference(sql, ident.end)) {
			out += ident.raw;
			i = ident.end;
			continue;
		}
		const lower = ident.name.toLowerCase();
		if (isPhysicalCatalogName(lower)) {
			throw new Error('Physical Trino catalog names are internal and cannot be referenced directly.');
		}
		const physical = aliases.get(lower);
		if (!physical) {
			throw new Error(`Unknown source catalog "${ident.name}" for this workspace.`);
		}
		out += physical;
		i = ident.end;
	}
	return out;
}
