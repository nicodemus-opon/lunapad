import { describe, expect, it } from 'vitest';
import { compile as compileNodePrql, CompileOptions as NodeCompileOptions } from 'prqlc/dist/node/prqlc_js';

import { PRQL_DOC_SNIPPETS } from '$lib/services/prql-doc-snippets';
import { prqlToGuiStages, guiToPreql } from '$lib/services/gui-prql';

describe('PRQL docs snippet parity', () => {
	const opts = new NodeCompileOptions();
	opts.target = 'sql.duckdb';
	opts.signature_comment = false;
	opts.format = true;

	it('compiles all canonical snippets from linked docs pages', () => {
		for (const snippet of PRQL_DOC_SNIPPETS) {
			expect(() => compileNodePrql(snippet.prql, opts)).not.toThrow();
		}
	});

	it('parses all snippets into non-null GUI stage chains', () => {
		for (const snippet of PRQL_DOC_SNIPPETS) {
			const parsed = prqlToGuiStages(snippet.prql);
			expect(parsed, snippet.id).not.toBeNull();
		}
	});

	it('round-trips aggregate snippets structurally through GUI stage serializer', () => {
		const aggregateSnippets = PRQL_DOC_SNIPPETS.filter((s) => s.tags.includes('aggregate'));
		for (const snippet of aggregateSnippets) {
			const parsed = prqlToGuiStages(snippet.prql);
			expect(parsed, snippet.id).not.toBeNull();
			if (!parsed) continue;
			const regenerated = guiToPreql(parsed);
			expect(() => compileNodePrql(regenerated, opts)).not.toThrow();
		}
	});
});
