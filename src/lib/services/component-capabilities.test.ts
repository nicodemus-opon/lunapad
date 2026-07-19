import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CHART_TYPES, FILTER_KINDS } from './generated-dashboard';
import {
	assertComponentCapabilityCompleteness,
	buildComponentCapabilityPromptBlock,
	EDITOR_INSPECTOR_CATALOG,
	SLASH_COMPONENT_CATALOG,
	getComponentCapabilityCatalog,
	getGeneratedComponentCapabilityArtifact
} from './component-capabilities';
import { CUSTOM_MARKDOC_TAGS } from './markdoc-tag-registry';
import { MARKDOC_TAG_CATALOG } from './markdoc-catalog';
import { compileNotebookBlueprint, type NotebookBlueprintBlock } from './notebook-blueprint';

describe('component capability registry', () => {
	it('covers every custom Markdoc component with an AI-authorable manifest', () => {
		expect(() => assertComponentCapabilityCompleteness()).not.toThrow();
		const catalog = getComponentCapabilityCatalog();
		const ids = new Set(catalog.components.map((component) => component.id));
		for (const tag of CUSTOM_MARKDOC_TAGS) expect(ids.has(tag)).toBe(true);
		expect(ids.has('text')).toBe(true);
		expect(ids.has('divider')).toBe(true);
		expect(ids.has('queryBlock')).toBe(true);
		expect(ids.has('conditional')).toBe(true);
		expect(catalog.version).toMatch(/^component-capabilities\.v1\.[a-f0-9]+$/);
		expect(catalog.hash).toMatch(/^[a-f0-9]+$/);
	});

	it('derives chart and filter option enums from runtime-supported values', () => {
		const catalog = getComponentCapabilityCatalog();
		const chart = catalog.components.find((component) => component.id === 'chart');
		const filter = catalog.components.find((component) => component.id === 'filter');
		expect(chart?.propsSchema.type.enum).toEqual(expect.arrayContaining([...CHART_TYPES]));
		expect(filter?.propsSchema.kind.enum).toEqual(expect.arrayContaining([...FILTER_KINDS]));
	});

	it('drives editor inspector option catalogs from runtime manifests', () => {
		expect(EDITOR_INSPECTOR_CATALOG.chartTypes).toEqual(
			getComponentCapabilityCatalog().components.find((component) => component.id === 'chart')
				?.propsSchema.type.enum
		);
		expect(EDITOR_INSPECTOR_CATALOG.filterKinds).toEqual(
			getComponentCapabilityCatalog().components.find((component) => component.id === 'filter')
				?.propsSchema.kind.enum
		);
		expect(EDITOR_INSPECTOR_CATALOG.quickChartTypes.every((type) => CHART_TYPES.has(type))).toBe(
			true
		);
		expect(EDITOR_INSPECTOR_CATALOG.quickFilterKinds.every((kind) => FILTER_KINDS.has(kind))).toBe(
			true
		);
	});

	it('keeps slash component catalog generated from authorable Markdoc manifests', () => {
		const slashIds = new Set(SLASH_COMPONENT_CATALOG.map((entry) => entry.id));
		for (const tagName of Object.keys(MARKDOC_TAG_CATALOG)) {
			expect(slashIds.has(tagName), `${tagName} missing from slash component catalog`).toBe(true);
		}
		expect(SLASH_COMPONENT_CATALOG.find((entry) => entry.id === 'chart')?.snippet).toBe(
			MARKDOC_TAG_CATALOG.chart.slashSnippet
		);
	});

	it('keeps the visual inspector wired to generated registry options', () => {
		const source = fs.readFileSync(
			path.resolve('src/lib/components/markdown/visual/VisualBlockInspector.svelte'),
			'utf8'
		);
		expect(source).toContain('EDITOR_INSPECTOR_CATALOG');
		expect(source).not.toContain("const chartTypes = [\n\t\t'table'");
		expect(source).not.toContain("const filterKinds = [\n\t\t'dropdown'");
	});

	it('builds AI prompt grammar from registered manifests', () => {
		const prompt = buildComponentCapabilityPromptBlock();
		const catalog = getComponentCapabilityCatalog();
		expect(prompt).toContain(catalog.version);
		expect(prompt).toContain('repair_notebook_blueprint');
		expect(prompt).toContain('aliases: plot|visualization|chartConfig');
		for (const id of ['text', 'queryBlock', 'metric', 'chart', 'datatable', 'filter']) {
			expect(prompt).toContain(`- ${id} [`);
		}
	});

	it('builds a generated catalog artifact for downstream surfaces', () => {
		const artifact = getGeneratedComponentCapabilityArtifact();
		expect(artifact).toMatchObject({
			generatedAt: 'build-time',
			version: getComponentCapabilityCatalog().version,
			hash: getComponentCapabilityCatalog().hash,
			catalog: { components: expect.any(Array) },
			editorInspector: { chartTypes: expect.any(Array) },
			slashComponents: expect.any(Array),
			promptGrammar: expect.stringContaining('SELF-DESCRIBING NOTEBOOK APP COMPONENTS')
		});
		expect(() => JSON.stringify(artifact)).not.toThrow();
	});

	it('keeps generated prompt grammar limited to registered components and props', () => {
		const catalog = getComponentCapabilityCatalog();
		const byId = new Map(catalog.components.map((component) => [component.id, component]));
		for (const line of buildComponentCapabilityPromptBlock().split('\n')) {
			const match = line.match(/^- ([^ ]+) \[[^\]]+\](?: props: (.*?))?(?: aliases: .*)?$/);
			if (!match) continue;
			const component = byId.get(match[1]);
			expect(component, `unknown prompt component ${match[1]}`).toBeDefined();
			const props = match[2]?.split(', ').map((prop) => prop.replace(/[!?].*$/, '')) ?? [];
			for (const prop of props) {
				expect(
					component?.propsSchema[prop],
					`${match[1]}.${prop} absent from registry`
				).toBeDefined();
			}
		}
	});

	it('runtime compiler accepts representative blocks for every registered blueprint block type', () => {
		const sampleBlocks: NotebookBlueprintBlock[] = [
			{ type: 'text', content: '# Runtime samples' },
			{ type: 'divider' },
			{ type: 'queryBlock', cellId: 'q_rows' },
			{ type: 'metric', value: '$metric.value', label: 'Value', icon: 'Gauge' },
			{ type: 'chart', data: '$rows.rows', chartType: 'bar', x: 'category', y: 'value' },
			{ type: 'datatable', data: '$rows.rows', cols: ['category', 'value'] },
			{ type: 'badge', value: '$metric.status', color: 'info' },
			{ type: 'progress', value: '$metric.value', max: 100, label: 'Done' },
			{ type: 'grid', cols: 2, items: [{ type: 'metric', value: 1, label: 'One' }] },
			{
				type: 'columns',
				columns: [{ width: 2, blocks: [{ type: 'text', content: 'Left' }] }, { blocks: [] }]
			},
			{ type: 'card', title: 'Card', blocks: [{ type: 'text', content: 'Body' }] },
			{ type: 'callout', variant: 'info', blocks: [{ type: 'text', content: 'Note' }] },
			{ type: 'details', summary: 'More', blocks: [{ type: 'text', content: 'Hidden' }] },
			{
				type: 'tabs',
				tabs: [{ label: 'Rows', blocks: [{ type: 'datatable', data: '$rows.rows' }] }]
			},
			{ type: 'filter', kind: 'dropdown', param: 'category', label: 'Category' },
			{ type: 'mermaid', code: 'flowchart LR\nA --> B' },
			{
				type: 'each',
				data: '$rows.rows',
				template: '{% metric value=$value label="$category" /%}'
			},
			{ type: 'group', data: '$rows.rows', by: 'category', template: '$key' },
			{
				type: 'conditional',
				test: { op: 'gt', left: '$metric.value', right: 0 },
				then: [{ type: 'text', content: 'Positive' }]
			},
			{ type: 'toc' },
			{ type: 'math', latex: 'E = mc^2' },
			{ type: 'video', src: 'https://example.com/video.mp4' },
			{ type: 'embed', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
			{ type: 'bookmark', url: 'https://example.com', title: 'Example' }
		];
		const compiled = compileNotebookBlueprint(
			{
				executableCells: [
					{
						cellId: 'q_rows',
						outputName: 'rows',
						cellType: 'query',
						language: 'sql',
						code: 'select 1 as value'
					}
				],
				blocks: sampleBlocks
			},
			['rows', 'metric']
		);
		expect(compiled.diagnostics).toEqual([]);
	});

	it('publishes the core primitives needed for broad data apps', () => {
		const catalog = getComponentCapabilityCatalog();
		expect(catalog.aiAuthorableComponentIds).toEqual(
			expect.arrayContaining([
				'text',
				'queryBlock',
				'metric',
				'chart',
				'datatable',
				'filter',
				'grid',
				'columns'
			])
		);
		expect(catalog.components.find((component) => component.id === 'chart')).toMatchObject({
			kind: 'data_view',
			dataRequirements: expect.arrayContaining([expect.stringContaining('row array')]),
			repairRules: expect.arrayContaining([expect.stringContaining('invalid chart type')])
		});
	});
});
