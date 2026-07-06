import type { ExternalSchemaTable, UploadedTable, Cell } from '$lib/stores/notebook.svelte';
import type { Connection } from '$lib/types/connection';

export type PythonTableSource = 'cell' | 'local' | 'external';

export interface PythonTableDescriptor {
	dataKey: string;
	canonicalName: string;
	source: PythonTableSource;
	aliases: string[];
	attributeAlias?: string | null;
	bindBareGlobal?: string | null;
	columns: string[];
	columnTypes?: string[];
	description?: string;
	rowMode: 'preview' | 'full';
}

export interface PythonTableHint {
	canonicalName: string;
	source: Exclude<PythonTableSource, 'cell'>;
	aliases: string[];
	attributeAlias?: string | null;
	columns: string[];
	columnTypes?: string[];
	description?: string;
}

interface PythonCatalogEntryBase {
	canonicalName: string;
	aliases: string[];
	attributeAlias?: string | null;
	columns: string[];
	columnTypes?: string[];
	description?: string;
}

export interface PythonLocalCatalogEntry extends PythonCatalogEntryBase {
	source: 'local';
}

export interface PythonExternalCatalogEntry extends PythonCatalogEntryBase {
	source: 'external';
	connectionId: string;
	connectionName: string;
	schema?: string;
	catalogName?: string;
}

export type PythonCatalogEntry = PythonLocalCatalogEntry | PythonExternalCatalogEntry;

const DEFAULT_HINT_LIMIT = 24;
const MAX_DOC_COLUMNS = 10;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeName(value: string): string {
	return value.trim().replace(/^["'`]|["'`]$/g, '').toLowerCase();
}

export function isPythonIdentifier(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9_.\s]/g, ' ')
		.split(/\s+/)
		.filter((part) => part.length > 1);
}

export function buildPythonCatalogEntries(args: {
	localTables: UploadedTable[];
	externalTables: ExternalSchemaTable[];
	connections: Connection[];
}): PythonCatalogEntry[] {
	const { localTables, externalTables, connections } = args;
	const entries: PythonCatalogEntry[] = localTables.map((table) => ({
		source: 'local',
		canonicalName: table.name,
		aliases: [table.name],
		attributeAlias: isPythonIdentifier(table.name) ? table.name : null,
		columns: table.columns,
		columnTypes: table.columnTypes,
		description: table.fileName
	}));

	for (const table of externalTables) {
		const connection = connections.find((entry) => entry.id === table.connectionId);
		const catalogName =
			connection && 'catalogName' in connection ? (connection.catalogName ?? undefined) : undefined;
		const canonicalName =
			catalogName && table.schema
				? `${catalogName}.${table.schema}.${table.name}`
				: table.schema
					? `${table.schema}.${table.name}`
					: catalogName
						? `${catalogName}.${table.name}`
						: table.name;
		const aliases = [canonicalName];
		if (table.schema) aliases.push(`${table.schema}.${table.name}`);
		entries.push({
			source: 'external',
			connectionId: table.connectionId,
			connectionName: table.connectionName,
			schema: table.schema,
			catalogName,
			canonicalName,
			aliases: [...new Set(aliases)],
			attributeAlias: null,
			columns: table.columns,
			columnTypes: table.columnTypes,
			description: table.description
		});
	}

	return entries;
}

function namesReferencedInCode(code: string): Set<string> {
	const referenced = new Set<string>();
	for (const ref of extractPythonTableRefs(code).itemNames) referenced.add(normalizeName(ref));
	for (const ref of extractPythonTableRefs(code).loadNames) referenced.add(normalizeName(ref));
	for (const ref of extractPythonTableRefs(code).attributeNames) referenced.add(normalizeName(ref));
	return referenced;
}

export function rankPythonTableHints(
	code: string,
	entries: PythonCatalogEntry[],
	limit = DEFAULT_HINT_LIMIT
): PythonTableHint[] {
	if (entries.length === 0) return [];
	const queryTokens = new Set(tokenize(code));
	const referencedNames = namesReferencedInCode(code);

	return entries
		.map((entry, idx) => {
			const names = [entry.canonicalName, ...entry.aliases];
			const tokens = names.flatMap(tokenize);
			const exactRef = names.some((name) => referencedNames.has(normalizeName(name)))
				? 100
				: entry.attributeAlias && referencedNames.has(normalizeName(entry.attributeAlias))
					? 100
					: 0;
			const overlap = tokens.filter((token) => queryTokens.has(token)).length;
			const localBoost = entry.source === 'local' ? 5 : 0;
			const attrBoost = entry.attributeAlias ? 2 : 0;
			return { entry, idx, score: exactRef + overlap * 3 + localBoost + attrBoost };
		})
		.sort((a, b) => b.score - a.score || a.idx - b.idx)
		.slice(0, limit)
		.map(({ entry }) => ({
			canonicalName: entry.canonicalName,
			source: entry.source,
			aliases: entry.aliases,
			attributeAlias: entry.attributeAlias,
			columns: entry.columns.slice(0, MAX_DOC_COLUMNS),
			columnTypes: entry.columnTypes?.slice(0, MAX_DOC_COLUMNS),
			description: entry.description
		}));
}

export function formatPythonTableHintDoc(hint: {
	canonicalName: string;
	source: string;
	columns: string[];
	columnTypes?: string[];
	description?: string;
}): string {
	const parts: string[] = [`**${hint.canonicalName}**`, `Source: ${hint.source}`];
	if (hint.description) parts.push(hint.description);
	if (hint.columns.length > 0) {
		const cols = hint.columns
			.map((column, idx) =>
				hint.columnTypes?.[idx] ? `- \`${column}\` (${hint.columnTypes[idx]})` : `- \`${column}\``
			)
			.join('\n');
		parts.push(`Columns:\n${cols}`);
	}
	return parts.join('\n\n');
}

export function extractPythonTableRefs(code: string): {
	attributeNames: string[];
	itemNames: string[];
	loadNames: string[];
} {
	const attributeNames = new Set<string>();
	const itemNames = new Set<string>();
	const loadNames = new Set<string>();

	for (const match of code.matchAll(/\btables\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
		const name = match[1];
		if (name !== 'load' && name !== 'find' && name !== 'available') attributeNames.add(name);
	}
	for (const match of code.matchAll(/\btables\[\s*["']([^"'\\]+)["']\s*\]/g)) {
		itemNames.add(match[1]);
	}
	for (const match of code.matchAll(/\btables\.load\(\s*["']([^"'\\]+)["']\s*\)/g)) {
		loadNames.add(match[1]);
	}

	return {
		attributeNames: [...attributeNames],
		itemNames: [...itemNames],
		loadNames: [...loadNames]
	};
}

export function resolvePythonCatalogEntry(
	name: string,
	entries: PythonCatalogEntry[]
): PythonCatalogEntry | null {
	const target = normalizeName(name);
	for (const entry of entries) {
		if (normalizeName(entry.canonicalName) === target) return entry;
		if (entry.attributeAlias && normalizeName(entry.attributeAlias) === target) return entry;
		if (entry.aliases.some((alias) => normalizeName(alias) === target)) return entry;
	}
	return null;
}

export function findReferencedBareLocalTables(
	code: string,
	entries: PythonCatalogEntry[],
	alreadyBound: Set<string>
): PythonLocalCatalogEntry[] {
	const refs: PythonLocalCatalogEntry[] = [];
	for (const entry of entries) {
		if (entry.source !== 'local') continue;
		if (!entry.attributeAlias || alreadyBound.has(entry.attributeAlias)) continue;
		const re = new RegExp(`\\b${escapeRegExp(entry.attributeAlias)}\\b`);
		if (re.test(code)) refs.push(entry);
	}
	return refs;
}

export function buildPythonUpstreamDescriptors(cells: Cell[]): PythonTableDescriptor[] {
	return cells
		.filter((cell) => (cell.cellType === 'query' || cell.cellType === 'python') && cell.outputName)
		.map((cell) => ({
			dataKey: cell.outputName,
			canonicalName: cell.outputName,
			source: 'cell',
			aliases: [cell.outputName],
			attributeAlias: isPythonIdentifier(cell.outputName) ? cell.outputName : null,
			bindBareGlobal: cell.outputName,
			columns: cell.result?.columns ?? [],
			rowMode: 'preview'
		}));
}
