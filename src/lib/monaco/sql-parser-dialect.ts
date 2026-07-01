import type { ConnectionType } from '$lib/types/connection';

export type SqlParserDialect = 'trino' | 'postgresql';

/** Map Lunapad connection types to node-sql-parser dialect names. */
export function connectionToParserDialect(
	connectionType: ConnectionType | undefined
): SqlParserDialect {
	return connectionType === 'duckdb-wasm' ? 'postgresql' : 'trino';
}

type ParserInstance = {
	astify: (sql: string, opt?: { database?: string; parseOptions?: { includeLocations?: boolean } }) => unknown;
};

let trinoParser: ParserInstance | null = null;
let postgresParser: ParserInstance | null = null;
let initPromise: Promise<void> | null = null;

type ParserCtor = new () => ParserInstance;

function resolveParserCtor(mod: unknown): ParserCtor {
	const m = mod as { Parser?: ParserCtor; default?: { Parser?: ParserCtor } };
	const Parser = m.Parser ?? m.default?.Parser;
	if (!Parser) throw new Error('node-sql-parser: Parser export not found');
	return Parser;
}

/** Preload dialect parser bundles — call once from setupMonaco(). */
export function initSqlParsers(): Promise<void> {
	if (trinoParser && postgresParser) return Promise.resolve();
	if (initPromise) return initPromise;
	initPromise = (async () => {
		const [trinoMod, pgMod] = await Promise.all([
			import('node-sql-parser/build/trino.js'),
			import('node-sql-parser/build/postgresql.js')
		]);
		const TrinoParser = resolveParserCtor(trinoMod);
		const PostgresParser = resolveParserCtor(pgMod);
		trinoParser = new TrinoParser();
		postgresParser = new PostgresParser();
	})().catch((err) => {
		initPromise = null;
		console.warn('[sql-scope] Failed to load SQL parsers — falling back to regex scope', err);
	});
	return initPromise;
}

export function sqlParsersReady(): boolean {
	return trinoParser !== null && postgresParser !== null;
}

function parserFor(dialect: SqlParserDialect): ParserInstance | null {
	return dialect === 'trino' ? trinoParser : postgresParser;
}

export function parseSqlAst(
	sql: string,
	dialect: SqlParserDialect,
	options?: { includeLocations?: boolean }
): unknown | null {
	const parser = parserFor(dialect);
	if (!parser) return null;
	const trimmed = sql.trim();
	if (!trimmed) return null;
	const db = dialect === 'trino' ? 'Trino' : 'PostgreSQL';
	for (const candidate of [trimmed, `${trimmed};`]) {
		try {
			return parser.astify(candidate, {
				database: db,
				parseOptions: options?.includeLocations ? { includeLocations: true } : undefined
			});
		} catch {
			// incomplete SQL while typing — try next candidate or fall back
		}
	}
	return null;
}

/** Test-only: load parsers synchronously via the full bundle. */
export async function initSqlParsersForTests(): Promise<void> {
	if (sqlParsersReady()) return;
	const pkg = await import('node-sql-parser');
	const Parser = (pkg.default as { Parser: new () => ParserInstance }).Parser;
	const p = new Parser();
	trinoParser = p;
	postgresParser = p;
}
