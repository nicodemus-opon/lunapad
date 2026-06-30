/**
 * In-process SQL LSP server — runs inside the Vite dev plugin (no subprocess).
 * One instance is created per WebSocket connection; all share the function catalog.
 *
 * Capabilities provided:
 *  - textDocument/completion  (functions + keywords from catalog, schema from client)
 *  - textDocument/hover       (function signature + doc from catalog)
 *  - textDocument/signatureHelp (parameter hints while inside a function call)
 */
import {
	createConnection,
	TextDocuments,
	CompletionItemKind,
	MarkupKind,
	TextDocumentSyncKind,
	type MessageReader,
	type MessageWriter,
	type InitializeResult,
	type CompletionItem,
	type TextDocumentPositionParams,
	type HoverParams,
	type SignatureHelpParams,
	type SignatureHelp,
	type SignatureInformation,
	type ParameterInformation,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load catalogs once at module level — shared across all connections.
// Paths are relative to this file: src/lib/server/ → src/lib/data/
const trinoFunctions: { name: string; signature: string; doc: string }[] =
	require(resolve(__dirname, '../data/trino-functions.json'));
const duckdbFunctions: { name: string; signature: string; doc: string }[] =
	require(resolve(__dirname, '../data/duckdb-functions.json'));

// Dialect hint is passed in the workspace folder name by the client.
const TRINO_LANGS = new Set(['trinosql', 'sql']);

type FnDoc = { name: string; signature: string; doc: string };

function catalogFor(languageId: string): FnDoc[] {
	return TRINO_LANGS.has(languageId) ? trinoFunctions : duckdbFunctions;
}

function indexCatalog(fns: FnDoc[]): Map<string, FnDoc> {
	const m = new Map<string, FnDoc>();
	for (const fn of fns) m.set(fn.name.toLowerCase(), fn);
	return m;
}

const trinoIndex = indexCatalog(trinoFunctions);
const duckdbIndex = indexCatalog(duckdbFunctions);

function indexFor(languageId: string): Map<string, FnDoc> {
	return TRINO_LANGS.has(languageId) ? trinoIndex : duckdbIndex;
}

// Parse the function name being called at cursor position for signatureHelp.
// Scans backwards from cursor to find the innermost unclosed '(' and the name before it.
function getFunctionCallContext(
	text: string,
	offset: number
): { name: string; paramIndex: number } | null {
	let depth = 0;
	let i = offset - 1;
	while (i >= 0) {
		const ch = text[i];
		if (ch === ')') { depth++; i--; continue; }
		if (ch === '(') {
			if (depth > 0) { depth--; i--; continue; }
			// Found unclosed '(' — scan backwards for identifier
			let j = i - 1;
			while (j >= 0 && /\s/.test(text[j])) j--;
			let end = j + 1;
			while (j >= 0 && /[a-z0-9_]/i.test(text[j])) j--;
			const name = text.slice(j + 1, end).toLowerCase();
			if (!name) return null;
			// Count commas at this nesting depth to find active param
			let paramIndex = 0;
			let d2 = 0;
			for (let k = i + 1; k < offset; k++) {
				if (text[k] === '(') d2++;
				else if (text[k] === ')') d2--;
				else if (text[k] === ',' && d2 === 0) paramIndex++;
			}
			return { name, paramIndex };
		}
		i--;
	}
	return null;
}

// Parse parameter names from a signature like `func(arg1, arg2, ...)`.
function parseParams(signature: string): string[] {
	const m = signature.match(/\(([^)]*)\)/);
	if (!m) return [];
	return m[1].split(',').map((p) => p.trim()).filter(Boolean);
}

// SQL keywords common to both Trino and DuckDB (for completions).
const SQL_KEYWORDS = [
	'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT',
	'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'CROSS JOIN',
	'ON', 'AS', 'DISTINCT', 'WITH', 'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
	'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE TABLE', 'DROP TABLE',
	'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IN', 'NOT IN', 'EXISTS', 'NOT EXISTS',
	'BETWEEN', 'LIKE', 'ILIKE', 'IS NULL', 'IS NOT NULL',
	'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST',
	'OVER', 'PARTITION BY', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT ROW',
	'CAST', 'TRY_CAST', 'COALESCE', 'NULLIF', 'IF',
	'TRUE', 'FALSE', 'NULL',
];

export function startLspForConnection(reader: MessageReader, writer: MessageWriter): void {
	const connection = createConnection(reader, writer);
	const documents = new TextDocuments(TextDocument);

	connection.onInitialize((): InitializeResult => ({
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: { triggerCharacters: ['.', '(', ' '] },
			hoverProvider: true,
			signatureHelpProvider: { triggerCharacters: ['(', ','] },
		},
		serverInfo: { name: 'lunapad-sql-lsp', version: '1.0.0' },
	}));

	connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return [];
		const lang = doc.languageId;
		const catalog = catalogFor(lang);
		const items: CompletionItem[] = [];

		// Functions from catalog
		for (const fn of catalog) {
			items.push({
				label: fn.name,
				kind: CompletionItemKind.Function,
				detail: fn.signature,
				documentation: { kind: MarkupKind.Markdown, value: fn.doc },
				insertText: fn.name,
				sortText: '1' + fn.name,
			});
		}

		// SQL keywords
		for (const kw of SQL_KEYWORDS) {
			items.push({
				label: kw,
				kind: CompletionItemKind.Keyword,
				insertText: kw,
				sortText: '2' + kw,
			});
		}

		return items;
	});

	connection.onHover((params: HoverParams) => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return null;
		const text = doc.getText();
		const offset = doc.offsetAt(params.position);

		// Extract word at cursor
		let start = offset;
		let end = offset;
		while (start > 0 && /[a-z0-9_]/i.test(text[start - 1])) start--;
		while (end < text.length && /[a-z0-9_]/i.test(text[end])) end++;
		const word = text.slice(start, end).toLowerCase();
		if (!word) return null;

		const fn = indexFor(doc.languageId).get(word);
		if (!fn) return null;

		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: `**\`${fn.signature}\`**\n\n${fn.doc}`,
			},
		};
	});

	connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | null => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc) return null;
		const text = doc.getText();
		const offset = doc.offsetAt(params.position);

		const ctx = getFunctionCallContext(text, offset);
		if (!ctx) return null;

		const fn = indexFor(doc.languageId).get(ctx.name);
		if (!fn) return null;

		const params2 = parseParams(fn.signature);
		const sigInfo: SignatureInformation = {
			label: fn.signature,
			documentation: { kind: MarkupKind.Markdown, value: fn.doc },
			parameters: params2.map((p): ParameterInformation => ({ label: p })),
		};

		return {
			signatures: [sigInfo],
			activeSignature: 0,
			activeParameter: Math.min(ctx.paramIndex, params2.length - 1),
		};
	});

	documents.listen(connection);
	connection.listen();
}
