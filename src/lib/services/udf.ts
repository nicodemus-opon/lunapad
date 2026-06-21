import type { Cell } from '$lib/stores/notebook.svelte';

export type UdfScalarType = 'bigint' | 'double' | 'varchar' | 'boolean' | 'date' | 'timestamp';

const PY_TYPE_TO_TRINO: Record<string, UdfScalarType> = {
	int: 'bigint',
	float: 'double',
	str: 'varchar',
	bool: 'boolean',
	'datetime.date': 'date',
	'datetime.datetime': 'timestamp'
};

export interface UdfParam {
	name: string;
	type: UdfScalarType;
}

export interface UdfSignature {
	name: string;
	params: UdfParam[];
	returnType: UdfScalarType;
}

export interface UdfParseError {
	error: string;
}

const TOP_LEVEL_DEF_RE = /^def\s+\w+/gm;
const DEF_LINE_RE = /^def\s+(\w+)\s*\(([^)]*)\)\s*->\s*([\w.]+)\s*:/m;

function mapPyType(annotation: string, context: string): UdfScalarType | UdfParseError {
	const trino = PY_TYPE_TO_TRINO[annotation];
	if (!trino) {
		return {
			error: `Unsupported type '${annotation}' ${context} (supported: ${Object.keys(PY_TYPE_TO_TRINO).join(', ')})`
		};
	}
	return trino;
}

/**
 * Parses the first top-level `def name(a: type, ...) -> type:` line into a
 * Trino-compatible signature. Regex-based, not a real Python parser —
 * deliberately rejects anything it can't confidently map (defaults, *args,
 * missing type hints, unmapped annotations, more than one top-level def)
 * rather than guessing.
 */
export function parseUdfSignature(pythonSource: string): UdfSignature | UdfParseError {
	const source = pythonSource ?? '';
	const defCount = source.match(TOP_LEVEL_DEF_RE)?.length ?? 0;
	if (defCount === 0) {
		return {
			error: 'No function definition found. Write a type-hinted `def name(...) -> type:` function.'
		};
	}
	if (defCount > 1) {
		return { error: 'Only one top-level function definition is allowed per UDF cell.' };
	}

	const match = source.match(DEF_LINE_RE);
	if (!match) {
		return {
			error:
				'Could not parse the function signature. Every parameter and the return value need a type hint, e.g. `def my_udf(x: int) -> float:`.'
		};
	}

	const [, name, rawParams, rawReturnType] = match;

	const returnType = mapPyType(rawReturnType, 'for the return type');
	if (typeof returnType === 'object') return returnType;

	const paramTokens = rawParams
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0);

	const params: UdfParam[] = [];
	for (const token of paramTokens) {
		if (token.startsWith('*')) {
			return { error: `Unsupported parameter '${token}' — *args/**kwargs are not supported.` };
		}
		if (token.includes('=')) {
			return { error: `Unsupported parameter '${token}' — default values are not supported.` };
		}
		const paramMatch = token.match(/^(\w+)\s*:\s*([\w.]+)$/);
		if (!paramMatch) {
			return { error: `Parameter '${token}' is missing a type hint, e.g. 'x: int'.` };
		}
		const [, paramName, rawType] = paramMatch;
		const type = mapPyType(rawType, `for parameter '${paramName}'`);
		if (typeof type === 'object') return type;
		params.push({ name: paramName, type });
	}

	return { name, params, returnType };
}

/**
 * Compiles a UDF cell's Python body into a Trino inline `FUNCTION ...` fragment
 * suitable for splicing into a WITH clause alongside CTEs.
 */
export function compileUdfFragment(cell: Cell): string | UdfParseError {
	const sig = parseUdfSignature(cell.udfBody);
	if ('error' in sig) return sig;

	const params = sig.params.map((p) => `${p.name} ${p.type}`).join(', ');
	return (
		`FUNCTION ${sig.name}(${params})\n` +
		`RETURNS ${sig.returnType}\n` +
		`LANGUAGE PYTHON\n` +
		`WITH (handler = '${sig.name}')\n` +
		`AS $$\n${cell.udfBody.trim()}\n$$`
	);
}
