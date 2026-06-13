import * as duckdb from '@duckdb/duckdb-wasm';
import { withTimeout } from '$lib/services/async';
import { arrowValueToJS } from '$lib/services/arrow-convert';

// Fixed paths served by the duckdb-static-serve Vite plugin (dev: from node_modules,
// build: copied to static/duckdb/). Using fixed URLs avoids the content-hash mismatch
// that breaks the worker's own scriptDirectory-relative WASM resolution in production.
const mvpWasmUrl = '/duckdb/duckdb-mvp.wasm';
const ehWasmUrl = '/duckdb/duckdb-eh.wasm';
const mvpWorkerUrl = '/duckdb/duckdb-browser-mvp.worker.js';
const ehWorkerUrl = '/duckdb/duckdb-browser-eh.worker.js';

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;
let worker: Worker | null = null;

const LOCAL_BUNDLES: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: mvpWasmUrl,
		mainWorker: mvpWorkerUrl
	},
	eh: {
		mainModule: ehWasmUrl,
		mainWorker: ehWorkerUrl
	}
};

async function resetDBState(): Promise<void> {
	if (conn) {
		try {
			await conn.close();
		} catch {
			// Ignore cleanup failures.
		}
		conn = null;
	}
	if (db) {
		try {
			await db.terminate();
		} catch {
			// Ignore cleanup failures.
		}
		db = null;
	}
	if (worker) {
		worker.terminate();
		worker = null;
	}
}

async function instantiateBundle(
	bundle: duckdb.DuckDBBundle,
	instantiateTimeoutMs = 12_000,
	connectTimeoutMs = 8_000
): Promise<void> {
	// Wrap the worker script in a same-origin blob URL. A blob: worker inherits the
	// document's Cross-Origin-Embedder-Policy, so it works even when the worker script
	// itself is served without a COEP header (vite dev middleware, adapter-node's sirv) —
	// a COEP-isolated document refuses to spawn network workers that lack that header.
	const workerScriptUrl = new URL(bundle.mainWorker!, globalThis.location.href).href;
	const workerBlobUrl = URL.createObjectURL(
		new Blob([`importScripts("${workerScriptUrl}");`], { type: 'text/javascript' })
	);
	try {
		worker = new Worker(workerBlobUrl);
		const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
		db = new duckdb.AsyncDuckDB(logger, worker);
		// Race instantiation against an immediate worker crash so we don't wait the full
		// timeout when the worker fails to start (e.g. WASM load error, CORS, CSP).
		const workerCrash = new Promise<never>((_, reject) => {
			worker!.addEventListener('error', (e) => {
				reject(new Error(`DuckDB worker failed: ${e.message || `check browser console (worker url: ${bundle.mainWorker})`}`));
			}, { once: true });
		});
		// Absolutize the WASM URL: the worker resolves relative URLs against its own
		// base, which is an opaque blob: URL here, so path-relative fetches would fail.
		const mainModuleUrl = new URL(bundle.mainModule, globalThis.location.href).href;
		await withTimeout(
			Promise.race([db.instantiate(mainModuleUrl, bundle.pthreadWorker), workerCrash]),
			'Instantiating DuckDB WASM engine',
			instantiateTimeoutMs
		);
		conn = await withTimeout(db.connect(), 'Opening DuckDB connection', connectTimeoutMs);
	} finally {
		// Safe to revoke once the worker has either loaded or failed.
		URL.revokeObjectURL(workerBlobUrl);
	}
}

function getBundleVariant(bundle: duckdb.DuckDBBundle): 'mvp' | 'eh' {
	return bundle.mainWorker?.includes('mvp') ? 'mvp' : 'eh';
}

export async function initDB(): Promise<void> {
	if (initPromise) return initPromise;
	initPromise = (async () => {
		try {
			const selectedBundle = await withTimeout(
				duckdb.selectBundle(LOCAL_BUNDLES),
				'Selecting DuckDB WASM bundle'
			);
			const selectedVariant = getBundleVariant(selectedBundle);
			const fallbackVariant = selectedVariant === 'mvp' ? 'eh' : 'mvp';

			try {
				await instantiateBundle(selectedBundle, 60_000, 12_000);
			} catch {
				await resetDBState();
				await instantiateBundle(LOCAL_BUNDLES[fallbackVariant] as duckdb.DuckDBBundle, 60_000, 12_000);
			}
		} catch (err: unknown) {
			await resetDBState();
			initPromise = null;
			throw err;
		}
	})();
	return initPromise;
}

function assertConn(): duckdb.AsyncDuckDBConnection {
	if (!conn) throw new Error('DuckDB not initialized. Call initDB() first.');
	return conn;
}

export type FileFormat = 'csv' | 'tsv' | 'parquet' | 'json' | 'ndjson';

export const FILE_FORMAT_EXTENSIONS: Record<FileFormat, string[]> = {
	csv: ['.csv'],
	tsv: ['.tsv'],
	parquet: ['.parquet', '.pq'],
	json: ['.json'],
	ndjson: ['.ndjson', '.jsonl'],
};

export const ACCEPT_ALL_FORMATS = Object.values(FILE_FORMAT_EXTENSIONS).flat().join(',');

export function detectFormat(filename: string): FileFormat | null {
	const lower = filename.toLowerCase();
	if (lower.endsWith('.csv')) return 'csv';
	if (lower.endsWith('.tsv')) return 'tsv';
	if (lower.endsWith('.parquet') || lower.endsWith('.pq')) return 'parquet';
	if (lower.endsWith('.ndjson') || lower.endsWith('.jsonl')) return 'ndjson';
	if (lower.endsWith('.json')) return 'json';
	return null;
}

export function sanitizeTableName(rawName: string): string {
	return rawName
		.replace(/\.[^.]+$/, '')
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.replace(/^([0-9])/, '_$1');
}

async function getTableMeta(
	c: ReturnType<typeof assertConn>,
	tableName: string
): Promise<{ rowCount: number; columns: string[]; columnTypes: string[] }> {
	const meta = await c.query(
		`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`
	);
	const rows = meta.toArray();
	const columns = rows.map((r) => r.column_name as string);
	const columnTypes = rows.map((r) => r.data_type as string);
	const countResult = await c.query(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
	const rowCount = Number(countResult.toArray()[0].cnt);
	return { rowCount, columns, columnTypes };
}

export async function registerFile(
	tableName: string,
	fileName: string,
	buffer: ArrayBuffer,
	format: FileFormat,
	options?: { header?: boolean }
): Promise<{ rowCount: number; columns: string[]; columnTypes: string[] }> {
	const c = assertConn();
	// Slice before passing so DuckDB's worker transfer doesn't detach the caller's buffer
	await db!.registerFileBuffer(fileName, new Uint8Array(buffer.slice(0)));
	await c.query(`DROP TABLE IF EXISTS "${tableName}"`);

	const header = options?.header !== false;
	let readExpr: string;
	if (format === 'csv') {
		readExpr = `read_csv_auto('${fileName}', header=${header})`;
	} else if (format === 'tsv') {
		readExpr = `read_csv_auto('${fileName}', header=${header}, delim='\\t')`;
	} else if (format === 'parquet') {
		readExpr = `read_parquet('${fileName}')`;
	} else {
		readExpr = `read_json_auto('${fileName}')`;
	}

	await c.query(`CREATE TABLE "${tableName}" AS SELECT * FROM ${readExpr}`);
	return getTableMeta(c, tableName);
}

export async function registerCSV(
	tableName: string,
	buffer: ArrayBuffer
): Promise<{ rowCount: number; columns: string[]; columnTypes: string[] }> {
	const ext = '.csv';
	return registerFile(tableName, `${tableName}${ext}`, buffer, 'csv');
}

export async function dropTable(tableName: string): Promise<void> {
	const c = assertConn();
	await c.query(`DROP TABLE IF EXISTS "${tableName}"`);
}

function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export type RelationType = 'table' | 'view';
export type MaterializationMode = 'table' | 'view' | 'incremental';

export interface MaterializedRelation {
	name: string;
	type: RelationType;
}

export interface RelationCatalogEntry {
	name: string;
	relationType: RelationType;
	rowCount: number;
	columns: string[];
	columnTypes: string[];
}

export async function dropRelation(name: string): Promise<void> {
	const c = assertConn();
	const ident = quoteIdent(name);
	await c.query(`DROP VIEW IF EXISTS ${ident}`);
	await c.query(`DROP TABLE IF EXISTS ${ident}`);
}

async function getRelationType(name: string): Promise<RelationType | null> {
	const c = assertConn();
	const rows = await c.query(
		`SELECT table_type
		 FROM information_schema.tables
		 WHERE table_schema = 'main' AND table_name = ${quoteLiteral(name)}
		 LIMIT 1`
	);
	const tableType = (rows.toArray()[0]?.table_type as string | undefined)?.toUpperCase();
	if (!tableType) return null;
	return tableType === 'VIEW' ? 'view' : 'table';
}

export async function materializeRelation(
	name: string,
	sql: string,
	mode: MaterializationMode
): Promise<MaterializedRelation> {
	const c = assertConn();
	const ident = quoteIdent(name);
	const existingType = await getRelationType(name);

	if (mode === 'view') {
		if (existingType === 'table') {
			await c.query(`DROP TABLE IF EXISTS ${ident}`);
		}
		await c.query(`CREATE OR REPLACE VIEW ${ident} AS (${sql})`);
		return { name, type: 'view' };
	}

	if (mode === 'table') {
		if (existingType === 'view') {
			await c.query(`DROP VIEW IF EXISTS ${ident}`);
		}
		await c.query(`CREATE OR REPLACE TABLE ${ident} AS (${sql})`);
		return { name, type: 'table' };
	}

	// Incremental mode in DuckDB: append new rows if table exists, create otherwise.
	if (existingType === 'view') {
		await c.query(`DROP VIEW IF EXISTS ${ident}`);
	}

	if (existingType !== 'table') {
		await c.query(`CREATE TABLE ${ident} AS (${sql})`);
		return { name, type: 'table' };
	}

	await c.query(`INSERT INTO ${ident} SELECT * FROM (${sql})`);
	return { name, type: 'table' };
}

export async function listMainSchemaRelations(): Promise<RelationCatalogEntry[]> {
	const c = assertConn();
	const relResult = await c.query(
		`SELECT table_name, table_type
		 FROM information_schema.tables
		 WHERE table_schema = 'main'
		   AND table_name != 'prev'
		 ORDER BY table_name`
	);

	const entries: RelationCatalogEntry[] = [];
	for (const row of relResult.toArray()) {
		const name = String(row.table_name);
		const relationType: RelationType = String(row.table_type).toUpperCase() === 'VIEW' ? 'view' : 'table';

		const colsResult = await c.query(
			`SELECT column_name, data_type
			 FROM information_schema.columns
			 WHERE table_schema = 'main' AND table_name = ${quoteLiteral(name)}
			 ORDER BY ordinal_position`
		);
		const columns = colsResult.toArray().map((r) => String(r.column_name));
		const columnTypes = colsResult.toArray().map((r) => String(r.data_type));

		const countResult = await c.query(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`);
		const rowCount = Number(countResult.toArray()[0]?.n ?? 0);

		entries.push({ name, relationType, rowCount, columns, columnTypes });
	}

	return entries;
}

export async function executeSQL(sql: string): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
	const c = assertConn();
	const result = await c.query(sql);
	const schema = result.schema;
	const columns = schema.fields.map((f) => f.name);
	const rows = result.toArray().map((row) => {
		const obj: Record<string, unknown> = {};
		for (const col of columns) {
			obj[col] = arrowValueToJS(row[col]);
		}
		return obj;
	});
	return { rows, columns };
}

export async function createView(viewName: string, sql: string): Promise<void> {
	const c = assertConn();
	const existingType = await getRelationType(viewName);
	if (existingType === 'table') {
		await c.query(`DROP TABLE IF EXISTS ${quoteIdent(viewName)}`);
	}
	await c.query(`CREATE OR REPLACE VIEW ${quoteIdent(viewName)} AS (${sql})`);
}

export async function dropView(viewName: string): Promise<void> {
	const c = assertConn();
	await c.query(`DROP VIEW IF EXISTS "${viewName}"`);
}

export interface CatalogColumn {
	name: string;
	type: string;
}

export interface CatalogTable {
	name: string;
	columns: CatalogColumn[];
}

export interface CatalogSchema {
	name: string;
	tables: CatalogTable[];
}

export interface DatabaseCatalogEntry {
	name: string;
	schemas: CatalogSchema[];
}

export async function getDatabaseCatalog(): Promise<DatabaseCatalogEntry[]> {
	const c = assertConn();

	// Step 1: non-internal databases (proven working in this codebase)
	const dbResult = await c.query(
		`SELECT database_name FROM duckdb_databases() WHERE internal = false ORDER BY database_name`
	);
	const dbNames = dbResult.toArray().map((r) => r.database_name as string);

	const entries: DatabaseCatalogEntry[] = [];
	for (const dbName of dbNames) {
		// Step 2: all non-system schemas (proven working in this codebase)
		const schemaResult = await c.query(
			`SELECT schema_name FROM duckdb_schemas()
			 WHERE database_name = '${dbName}'
			   AND schema_name NOT IN ('information_schema', 'pg_catalog')
			 ORDER BY schema_name`
		);
		const schemaNames = schemaResult.toArray().map((r) => r.schema_name as string);

		// Step 3: tables + columns via information_schema (proven working in this codebase)
		const colResult = await c.query(
			`SELECT table_schema, table_name, column_name, data_type
			 FROM information_schema.columns
			 WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
			 ORDER BY table_schema, table_name, ordinal_position`
		);

		// Build schema → table → column map
		const tablesBySchema = new Map<string, Map<string, CatalogColumn[]>>();
		for (const row of colResult.toArray()) {
			const schema = row.table_schema as string;
			const table = row.table_name as string;
			const col: CatalogColumn = { name: row.column_name as string, type: row.data_type as string };
			if (!tablesBySchema.has(schema)) tablesBySchema.set(schema, new Map());
			const tmap = tablesBySchema.get(schema)!;
			if (!tmap.has(table)) tmap.set(table, []);
			tmap.get(table)!.push(col);
		}

		// Emit every schema even when it has no tables yet
		const schemas: CatalogSchema[] = schemaNames.map((schemaName) => {
			const tmap = tablesBySchema.get(schemaName) ?? new Map<string, CatalogColumn[]>();
			return {
				name: schemaName,
				tables: [...tmap.entries()]
					.sort((a, b) => a[0].localeCompare(b[0]))
					.map(([tableName, columns]) => ({ name: tableName, columns }))
			};
		});

		entries.push({ name: dbName, schemas });
	}
	return entries;
}

/**
 * Load an array of row objects into a named DuckDB temp table for profiling.
 * Serializes up to 5 000 rows as NDJSON and materialises them via read_ndjson_auto.
 * The created table is named `"_p_<tempName>"`.
 */
export async function loadRowsForProfiling(
	tempName: string,
	rows: Record<string, unknown>[]
): Promise<void> {
	if (rows.length === 0) return;
	const c = assertConn();
	const sample = rows.slice(0, 5000);
	const ndjson = sample
		.map((r) => {
			const clean: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(r)) {
				if (v instanceof Date) {
					clean[k] = v.toISOString();
				} else if (typeof v === 'bigint') {
					clean[k] = Number(v);
				} else {
					clean[k] = v;
				}
			}
			return JSON.stringify(clean);
		})
		.join('\n');
	const safeName = tempName.replace(/[^a-zA-Z0-9_]/g, '_');
	const fileName = `_profile_${safeName}.ndjson`;
	await db!.registerFileBuffer(fileName, new TextEncoder().encode(ndjson));
	await c.query(
		`CREATE OR REPLACE TEMP TABLE "_p_${safeName}" AS SELECT * FROM read_ndjson_auto('${fileName}')`
	);
}

/** Drop a temp profiling table created by loadRowsForProfiling. */
export async function dropProfileTable(tempName: string): Promise<void> {
	try {
		const c = assertConn();
		const safeName = tempName.replace(/[^a-zA-Z0-9_]/g, '_');
		await c.query(`DROP TABLE IF EXISTS "_p_${safeName}"`);
	} catch {
		// Ignore cleanup failures
	}
}

export async function setPrevView(sourceName: string): Promise<void> {
	const c = assertConn();
	await c.query(`CREATE OR REPLACE VIEW "prev" AS SELECT * FROM "${sourceName}"`);
}

export async function dropPrevView(): Promise<void> {
	const c = assertConn();
	await c.query(`DROP VIEW IF EXISTS "prev"`);
}
