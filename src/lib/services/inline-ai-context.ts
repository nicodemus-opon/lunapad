import type { InlineCellEditColumn } from '$lib/services/inline-cell-ai';

type SchemaLikeTable = {
	name: string;
	columns: string[];
	columnTypes?: string[];
};

export type InlineAITablesContext = Array<{
	name: string;
	columns: string[];
	columnTypes: string[];
}>;

export function buildInlineAITablesContext(
	tables: SchemaLikeTable[],
	externalSchemaTables: SchemaLikeTable[],
	limit = 8
): InlineAITablesContext {
	return [...tables, ...externalSchemaTables].slice(0, limit).map((table) => ({
		name: table.name,
		columns: table.columns,
		columnTypes: table.columnTypes ?? []
	}));
}

export function inferInlineAISourceTable(
	code: string,
	language: 'prql' | 'sql',
	tables: SchemaLikeTable[],
	externalSchemaTables: SchemaLikeTable[]
): string | undefined {
	const fromRe =
		language === 'sql' ? /\bFROM\s+([a-zA-Z_][\w."]*)/i : /^\s*from\s+([a-zA-Z_][\w.]*)/im;
	const match = code.match(fromRe);
	if (!match) return undefined;
	const candidate = match[1].replace(/"/g, '');
	const found = [...tables, ...externalSchemaTables].find(
		(table) => table.name.toLowerCase() === candidate.toLowerCase()
	);
	return found?.name;
}

export function buildInlineAIColumns(
	sourceTable: string | undefined,
	tables: SchemaLikeTable[],
	externalSchemaTables: SchemaLikeTable[]
): InlineCellEditColumn[] {
	if (!sourceTable) return [];
	const found = [...tables, ...externalSchemaTables].find((table) => table.name === sourceTable);
	if (!found) return [];
	return found.columns.map((column, index) => ({
		name: column,
		dataKind: sqlTypeToDataKind(found.columnTypes?.[index] ?? ''),
		sqlType: found.columnTypes?.[index]
	}));
}

function sqlTypeToDataKind(sqlType: string): InlineCellEditColumn['dataKind'] {
	const type = sqlType.toUpperCase();
	if (/INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL/.test(type)) return 'numeric';
	if (/DATE|TIME/.test(type)) return 'date';
	if (/BOOL/.test(type)) return 'boolean';
	return 'text';
}
