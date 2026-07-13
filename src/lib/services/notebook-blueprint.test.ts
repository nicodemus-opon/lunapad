import { describe, expect, it } from 'vitest';
import {
	applyNotebookPatchOperations,
	compileNotebookBlueprint,
	validateNotebookPmDocument,
	type NotebookBlueprint
} from './notebook-blueprint';
import type { PMDocJSON } from './markdoc-pm';

describe('notebook-blueprint', () => {
	it('compiles nested notebook blueprints into valid PM nodes', () => {
		const blueprint: NotebookBlueprint = {
			title: 'Executive Revenue Review',
			executableCells: [
				{
					cellId: 'q_monthly_revenue',
					outputName: 'monthly_revenue',
					cellType: 'query',
					language: 'sql',
					code: 'SELECT month, SUM(revenue) AS revenue FROM orders GROUP BY 1'
				}
			],
			blocks: [
				{ type: 'text', content: '## Overview\n\nLive revenue from $monthly_revenue.revenue.' },
				{ type: 'queryBlock', cellId: 'q_monthly_revenue' },
				{
					type: 'tabs',
					tabs: [
						{
							label: 'Summary',
							blocks: [
								{
									type: 'columns',
									columns: [
										{
											width: 2,
											blocks: [
												{
													type: 'card',
													title: 'Trend',
													blocks: [
														{
															type: 'chart',
															ref: '$monthly_revenue',
															chartType: 'line'
														}
													]
												}
											]
										},
										{
											blocks: [
												{
													type: 'grid',
													cols: 1,
													items: [
														{
															type: 'metric',
															value: '$monthly_revenue.revenue',
															label: 'Revenue',
															format: 'currency'
														}
													]
												}
											]
										}
									]
								}
							]
						}
					]
				}
			]
		};

		const compiled = compileNotebookBlueprint(blueprint);
		expect(compiled.diagnostics).toEqual([]);
		expect(compiled.document).not.toBeNull();
		expect(validateNotebookPmDocument(compiled.document!)).toEqual([]);
		expect(compiled.document?.content?.some((node) => node.type === 'queryBlock')).toBe(true);
		expect(
			JSON.stringify(compiled.document).includes('"tagName":"tabs"') ||
				JSON.stringify(compiled.document).includes('\\"tagName\\":\\"tabs\\"')
		).toBe(true);
	});

	it('reports exact diagnostics for missing query payloads and unknown refs', () => {
		const compiled = compileNotebookBlueprint(
			{
				title: 'Broken',
				blocks: [
					{ type: 'queryBlock', cellId: 'q_missing' },
					{ type: 'metric', value: '$missing.total', label: 'Missing' }
				]
			},
			['known_cell']
		);

		expect(compiled.document).toBeNull();
		expect(compiled.diagnostics.map((d) => d.path)).toEqual(
			expect.arrayContaining(['blocks.0', 'blocks.1'])
		);
		expect(compiled.diagnostics.map((d) => d.message).join('\n')).toMatch(
			/q_missing|Unknown live reference/
		);
	});

	it('allows query blocks that reference existing notebook cells', () => {
		const compiled = compileNotebookBlueprint(
			{
				title: 'Existing Cell Report',
				blocks: [
					{ type: 'text', content: '## Revenue\n\nLive total: $monthly_revenue.revenue.' },
					{ type: 'queryBlock', cellId: 'cell_monthly_revenue' },
					{
						type: 'chart',
						ref: '$monthly_revenue',
						chartType: 'line'
					}
				]
			},
			['monthly_revenue'],
			['cell_monthly_revenue']
		);

		expect(compiled.diagnostics).toEqual([]);
		expect(compiled.document).not.toBeNull();
		expect(compiled.executableCells).toEqual([]);
	});

	// Regression: apply_notebook_patch's `document`/`operations` shapes (and the validate_notebook
	// tool) bypass compileNotebookBlueprint entirely — they hand a raw PM document straight to
	// validateNotebookPmDocument, which used to do zero $ref checking. A hallucinated ref would
	// silently pass validation, syncNotebookFromPmDocument would commit it, and the model would
	// call validate_notebook and get a false "ok: true" right before <done>.
	it('flags an unknown $ref in a raw PM widget node when knownRefs is passed', () => {
		const doc = {
			type: 'doc',
			content: [
				{
					type: 'markdocWidget',
					attrs: {
						tagName: 'metric',
						attrsJson: JSON.stringify({ label: 'Total', value: '$totallll.revenue' }),
						selfClosing: true
					}
				}
			]
		};
		expect(validateNotebookPmDocument(doc as never, ['revenue'])).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					message: expect.stringContaining('Unknown live reference "totallll"')
				})
			])
		);
		// Without knownRefs, callers get the old (structural-only) behavior — no ref checking.
		expect(validateNotebookPmDocument(doc as never)).toEqual([]);
	});

	it('accepts a $ref that matches a known cell outputName', () => {
		const doc = {
			type: 'doc',
			content: [
				{
					type: 'markdocWidget',
					attrs: {
						tagName: 'metric',
						attrsJson: JSON.stringify({ label: 'Total', value: '$revenue.total' }),
						selfClosing: true
					}
				}
			]
		};
		expect(validateNotebookPmDocument(doc as never, ['revenue'])).toEqual([]);
	});

	// Regression: found live against a real model, which sent a raw `document`/`operations`
	// payload where a node's `content` was a non-array value. `node.content ?? []` only guards
	// null/undefined, so this crashed every tree walker with "forEach is not a function" — an
	// unhandled exception instead of a repairable diagnostic (document/operations are raw,
	// hand-constructed PM JSON straight from the model — nothing guarantees well-formed shape).
	// Regression: found live against a real model, which reached for 'markdown' as the prose
	// block type name on its very first apply_notebook_patch call (arguably more intuitive than
	// 'text', since the block literally holds Markdoc prose) and got rejected.
	it('accepts "markdown" as an alias for the "text" block type', () => {
		const compiled = compileNotebookBlueprint({
			title: 'T',
			blocks: [{ type: 'markdown', content: '## Hello' } as never]
		});
		expect(compiled.diagnostics).toEqual([]);
		expect(compiled.document).not.toBeNull();
	});

	// Regression: found live — a model asked to "add a dashboard section" wrapped its widgets in
	// a "dashboard" block type that doesn't exist in the schema, got rejected, and then retried
	// the identical shape for its entire remaining turn budget without ever adapting. Splice the
	// wrapper's own blocks into the parent instead of rejecting.
	it('splices "dashboard"/"section" wrapper blocks into the parent instead of rejecting them', () => {
		const compiled = compileNotebookBlueprint({
			title: 'T',
			executableCells: [{ cellId: 'c1', outputName: 'revenue', code: 'select 1', language: 'sql' }],
			blocks: [
				{
					type: 'dashboard',
					blocks: [{ type: 'metric', label: 'Total', ref: '$revenue.value' }]
				} as never
			]
		});
		expect(compiled.diagnostics).toEqual([]);
		expect(compiled.document).not.toBeNull();
	});

	// Regression: found live — a model juggling both the `blueprint` shape (flat block types)
	// and the `document`/`operations` shape (raw PM nodes, taught by the operations tool
	// schema's own description) sent a raw markdocWidget PM node inside a blueprint `blocks`
	// array. Rejecting it with only "Unsupported block type markdocWidget" gave no path to
	// recover, so the model kept resubmitting the identical shape.
	it('unwraps a raw markdocWidget PM node found inside blueprint blocks', () => {
		const compiled = compileNotebookBlueprint({
			title: 'T',
			blocks: [
				{
					type: 'markdocWidget',
					attrs: {
						tagName: 'metric',
						attrsJson: '{"label":"Total Revenue","value":"1000"}',
						selfClosing: true
					}
				} as never
			]
		});
		expect(compiled.diagnostics).toEqual([]);
		expect(compiled.document).not.toBeNull();
	});

	// Regression: a 'text' block with a missing/non-string `content` field crashed the whole
	// request with "Cannot read properties of undefined (reading 'match')" deep inside
	// markdownToPmDocument's frontmatter regex instead of a repairable diagnostic.
	it('does not crash on a text block missing its content field', () => {
		expect(() =>
			compileNotebookBlueprint({
				title: 'T',
				blocks: [{ type: 'text' } as never]
			})
		).not.toThrow();
		const compiled = compileNotebookBlueprint({
			title: 'T',
			blocks: [{ type: 'text' } as never]
		});
		// A missing required field is a repairable diagnostic, not a crash — document is null
		// (same contract as every other malformed-input diagnostic in this file) but the compiler
		// itself must not throw.
		expect(compiled.diagnostics.length).toBeGreaterThan(0);
	});

	// Regression: found live — an `insert_node`/`replace_node` operation with a missing/malformed
	// `node` field crashed the whole request with "Cannot read properties of undefined (reading
	// 'type')" deep inside normalizePmNodeIds (it wraps `op.node` as `content: [op.node]`, and the
	// recursive normalizer indexed straight into that entry without checking it was a real node)
	// instead of surfacing the "invalid node" diagnostic the call site was already written to
	// produce.
	it('does not crash on insert_node/replace_node operations with a missing node', () => {
		const doc: PMDocJSON = {
			type: 'doc',
			content: [
				{ type: 'paragraph', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: 'hi' }] }
			]
		};
		expect(() =>
			applyNotebookPatchOperations(doc, [{ op: 'insert_node', node: undefined as never }])
		).not.toThrow();
		const insertResult = applyNotebookPatchOperations(doc, [
			{ op: 'insert_node', node: undefined as never }
		]);
		expect(insertResult.diagnostics.length).toBeGreaterThan(0);

		expect(() =>
			applyNotebookPatchOperations(doc, [
				{ op: 'replace_node', nodeId: 'p1', node: undefined as never }
			])
		).not.toThrow();
		const replaceResult = applyNotebookPatchOperations(doc, [
			{ op: 'replace_node', nodeId: 'p1', node: undefined as never }
		]);
		expect(replaceResult.diagnostics.length).toBeGreaterThan(0);
	});

	it('does not crash on a malformed non-array content field', () => {
		const doc = {
			type: 'doc',
			content: [
				{
					type: 'markdocContainer',
					attrs: { tagName: 'card', attrsJson: '{}' },
					content: 'this should be an array of nodes, not a string'
				}
			]
		};
		expect(() => validateNotebookPmDocument(doc as never, ['revenue'])).not.toThrow();
	});

	// Regression: getMarkdocPmSchema()'s underlying schema (prosemirror-markdown's
	// defaultMarkdownParser.schema) registers several node types under snake_case names
	// (horizontal_rule, bullet_list, list_item, code_block, hard_break, task_list, task_item)
	// while the PMDocJSON/PMNodeJSON shape used everywhere in this file is Tiptap-style camelCase
	// (horizontalRule, bulletList, ...). Every other nodeFromJSON call site in markdoc-pm.ts
	// converts via tiptapNodeJsonToPm first; validateNotebookPmDocument's schema check didn't,
	// so a divider, a bullet/ordered list in ordinary prose, or a code block (the mermaid
	// fallback with no codeRef) made the ENTIRE document fail validation with "Unknown node
	// type" — for content that occurs constantly in real AI-written notebooks.
	it('compiles a divider, a bullet list, and a code block without schema errors', () => {
		const divider = compileNotebookBlueprint({
			title: 'T',
			blocks: [
				{ type: 'text', content: 'Before' },
				{ type: 'divider' },
				{ type: 'text', content: 'After' }
			]
		});
		expect(divider.diagnostics).toEqual([]);
		expect(divider.document).not.toBeNull();

		const bulletList = compileNotebookBlueprint({
			title: 'T',
			blocks: [{ type: 'text', content: '- item one\n- item two\n- item three' }]
		});
		expect(bulletList.diagnostics).toEqual([]);
		expect(bulletList.document).not.toBeNull();

		const codeBlock = compileNotebookBlueprint({
			title: 'T',
			blocks: [{ type: 'mermaid', code: 'graph TD; A-->B;' } as never]
		});
		expect(codeBlock.diagnostics).toEqual([]);
		expect(codeBlock.document).not.toBeNull();
	});

	// Regression: `NotebookBlueprintBlock`'s metric/chart/datatable/badge/progress/filter cases are
	// typed as `GeneratedDashboardBlock` (this file's own type union), but until this fix nothing
	// in the compileBlock/widget() path reused generated-dashboard.ts's semantic checks (icon
	// allowlist, chart-type allowlist, span 1-4 bounds, filter-kind allowlist, iconCount/iconTotal
	// bounds, grid item-type restriction). Since blueprint is the ACTIVE create_notebook/
	// apply_notebook_patch surface (not the legacy generated-dashboard.ts payload), a model could
	// send an invalid icon name, an out-of-range span, an unsupported chart type, an invalid
	// filter kind, or a chart nested inside a grid tile and get zero diagnostics — then have it
	// silently break at render time.
	it('rejects an invalid icon/chartType/span/filter-kind/grid-item via blueprint', () => {
		const compiled = compileNotebookBlueprint(
			{
				title: 'T',
				blocks: [
					{ type: 'metric', value: 1, label: 'X', icon: 'not-a-real-icon' },
					{ type: 'chart', ref: '$x', chartType: 'pie-chart-typo' as never },
					{ type: 'metric', value: 1, label: 'X', span: 99 },
					{ type: 'filter', param: 'p', label: 'L', kind: 'not-a-kind' as never },
					{ type: 'grid', items: [{ type: 'chart', ref: '$x', chartType: 'line' }] }
				]
			},
			['x']
		);
		expect(compiled.document).toBeNull();
		const messages = compiled.diagnostics.map((d) => d.message).join('\n');
		expect(messages).toMatch(/Unknown metric icon "not-a-real-icon"/);
		expect(messages).toMatch(/Unsupported chart type "pie-chart-typo"/);
		expect(messages).toMatch(/span must be an integer between 1 and 4 \(got 99\)/);
		expect(messages).toMatch(/Unsupported filter kind "not-a-kind"/);
		expect(messages).toMatch(/Grid items must be small tiles/);
	});

	// Regression: same gap as above but for apply_notebook_patch's `document`/`operations` shapes
	// (and validate_notebook), which hand raw PM JSON straight to validateNotebookPmDocument and
	// never go through compileBlock at all.
	it('rejects the same invalid widget attrs in a raw PM document', () => {
		const doc: PMDocJSON = {
			type: 'doc',
			content: [
				{
					type: 'markdocWidget',
					attrs: {
						tagName: 'metric',
						attrsJson: JSON.stringify({ icon: 'not-a-real-icon' }),
						selfClosing: true
					}
				},
				{
					type: 'markdocContainer',
					attrs: { tagName: 'grid', attrsJson: '{}' },
					content: [
						{
							type: 'markdocWidget',
							attrs: {
								tagName: 'chart',
								attrsJson: JSON.stringify({ ref: '$x', type: 'line' }),
								selfClosing: true
							}
						}
					]
				}
			]
		};
		const diagnostics = validateNotebookPmDocument(doc, ['x']);
		const messages = diagnostics.map((d) => d.message).join('\n');
		expect(messages).toMatch(/Unknown metric icon "not-a-real-icon"/);
		expect(messages).toMatch(/Grid items must be small tiles/);
	});

	// Regression: the runtime chart widget reads its attrsJson `type` key (not `chartType`) — see
	// InlineWidgetNodeView.svelte's `attr(attrs.type, 'Chart')` — and the runtime callout node
	// view reads `type` (not `variant`) — see markdoc-container-extension.ts's
	// `String(attrs.type ?? 'info')`. Before this fix, compileBlock's generic attrsFromBlock(block)
	// carried the raw TS field names (`chartType`, `variant`) straight into attrsJson, so every
	// AI-generated chart silently fell back to the 'bar' default and every callout silently fell
	// back to the 'info' default, regardless of what the model actually asked for.
	it('renders chart.chartType and callout.variant under the attrsJson key "type"', () => {
		const compiled = compileNotebookBlueprint(
			{
				title: 'T',
				blocks: [
					{ type: 'chart', ref: '$x', chartType: 'pie' },
					{ type: 'callout', variant: 'warning', blocks: [{ type: 'text', content: 'careful' }] }
				]
			},
			['x']
		);
		expect(compiled.diagnostics).toEqual([]);
		const json = JSON.stringify(compiled.document);
		expect(json).toContain('\\"type\\":\\"pie\\"');
		expect(json).not.toContain('chartType');
		expect(json).toContain('\\"type\\":\\"warning\\"');
		expect(json).not.toContain('variant');
	});

	// Regression: compileNotebookBlueprint's `blueprint.executableCells ?? []` only guarded
	// null/undefined — a malformed non-array value (found live: a real model's tool-call JSON
	// with an illegal `\'` escape got dropped by the SSE parser, and a retry sent a non-array
	// executableCells) crashed the whole /api/ai/chat request with "executableCells.map is not a
	// function" instead of a repairable diagnostic.
	it('does not crash on a malformed non-array executableCells', () => {
		const compiled = compileNotebookBlueprint({
			title: 'T',
			// @ts-expect-error deliberately malformed input, mirrors a real model's bad tool call
			executableCells: { cellId: 'q1', outputName: 'q1', code: 'select 1' },
			blocks: [{ type: 'text', content: 'hello' }]
		});
		expect(compiled.document).toBeNull();
		expect(compiled.diagnostics.map((d) => d.message).join('\n')).toMatch(
			/executableCells must be an array/
		);
	});

	// Regression: a queryBlock node's OWN `cellType` attr (not its matching executableCells
	// entry) is what notebook.svelte.ts's rebuildCellsFromBlocks uses to construct a brand-new
	// cell. If a model's queryBlock block omits `cellType` (defaulting to 'query') while its
	// executableCells entry says 'python', the cell got created as a SQL stub;
	// materializeNotebookExecutableCells then skipped it (a cell already "existed" for that id);
	// and updatePythonCellCode's `cell.cellType !== 'python'` guard silently dropped the code —
	// apply_notebook_patch still reported "patched and validated" with the python code lost.
	it("derives a queryBlock's cellType from its matching executableCells entry, not the block's own field", () => {
		const compiled = compileNotebookBlueprint({
			title: 'T',
			executableCells: [{ cellId: 'q1', outputName: 'q1', cellType: 'python', code: 'print(1)' }],
			// Deliberately omit cellType here, as a real model did — 'query' is the default.
			blocks: [{ type: 'queryBlock', cellId: 'q1' }]
		});
		expect(compiled.diagnostics).toEqual([]);
		const queryBlockNode = compiled.document?.content?.find((n) => n.type === 'queryBlock');
		expect(queryBlockNode?.attrs?.cellType).toBe('python');
	});

	// Regression: found live against a real model — a malformed nested `blocks`/`columns`/`tabs`
	// field (most commonly a double-JSON-encoded string, e.g. "blocks":"[{...}]" instead of a
	// real array) has a truthy `.length`, so a `!value?.length` guard alone doesn't catch it.
	// `.flatMap`/`.map` then crashed the whole /api/ai/chat request with "blocks.flatMap is not
	// a function" instead of a repairable diagnostic.
	it('does not crash on malformed non-array blocks/columns/tabs fields', () => {
		const topLevel = compileNotebookBlueprint({
			title: 'T',
			// @ts-expect-error deliberately malformed, mirrors a real model's bad tool call
			blocks: '[{"type":"text","content":"hi"}]'
		});
		expect(topLevel.document).toBeNull();
		expect(topLevel.diagnostics.map((d) => d.message).join('\n')).toMatch(/array of blocks/);

		const nestedColumns = compileNotebookBlueprint({
			title: 'T',
			blocks: [{ type: 'columns', columns: '[{"blocks":[]}]' as never }]
		});
		expect(nestedColumns.document).toBeNull();
		expect(nestedColumns.diagnostics.map((d) => d.message).join('\n')).toMatch(/Expected an array/);

		const nestedTabs = compileNotebookBlueprint({
			title: 'T',
			blocks: [{ type: 'tabs', tabs: '[{"label":"A","blocks":[]}]' as never }]
		});
		expect(nestedTabs.document).toBeNull();
		expect(nestedTabs.diagnostics.map((d) => d.message).join('\n')).toMatch(/Expected an array/);
	});

	// Regression: `conditional.test` is required by the type but model-supplied — an omitted or
	// malformed `test` previously crashed with "Cannot read properties of undefined (reading
	// 'left')" instead of a repairable diagnostic.
	it('does not crash on a conditional block with a missing test', () => {
		const compiled = compileNotebookBlueprint({
			title: 'T',
			blocks: [{ type: 'conditional', then: [{ type: 'text', content: 'x' }] } as never]
		});
		expect(compiled.document).toBeNull();
		expect(compiled.diagnostics.map((d) => d.message).join('\n')).toMatch(
			/conditional requires a test/
		);
	});

	it('does not flag loop-scoped bare tokens inside an each/group container', () => {
		const doc = {
			type: 'doc',
			content: [
				{
					type: 'markdocContainer',
					attrs: {
						tagName: 'each',
						attrsJson: JSON.stringify({ data: '$orders', alias: 'row' })
					},
					content: [{ type: 'paragraph', content: [{ type: 'text', text: '$row.total' }] }]
				}
			]
		};
		expect(validateNotebookPmDocument(doc as never, ['orders'])).toEqual([]);
	});
});
