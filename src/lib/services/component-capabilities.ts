import { DASHBOARD_ICON_NAMES } from './dashboard-icons';
import { CHART_TYPES, FILTER_KINDS, SUPPORTED_BLOCK_TYPES } from './generated-dashboard';
import {
	MARKDOC_TAG_CATALOG,
	type MarkdocAttrCatalog,
	type MarkdocTagCatalogEntry
} from './markdoc-catalog';
import {
	CUSTOM_MARKDOC_TAGS,
	getMarkdocTagRegistryEntry,
	type MarkdocTagKind
} from './markdoc-tag-registry';

export type ComponentCapabilityKind =
	| 'layout'
	| 'data_view'
	| 'metric'
	| 'interaction'
	| 'narrative'
	| 'logic'
	| 'media'
	| 'notebook';

export type ComponentDiagnosticClass = 'repairable' | 'downgradable' | 'askable' | 'fatal';

export interface ComponentCapabilityProp {
	name: string;
	description?: string;
	required?: boolean;
	enum?: readonly string[];
}

export interface ComponentCapabilityManifest {
	id: string;
	kind: ComponentCapabilityKind;
	description: string;
	aiAuthorable: boolean;
	source: 'markdoc' | 'notebook-blueprint';
	markdocKind?: MarkdocTagKind;
	propsSchema: Record<string, ComponentCapabilityProp>;
	defaults: Record<string, unknown>;
	examples: string[];
	constraints: Array<{ class: ComponentDiagnosticClass; rule: string }>;
	repairRules: string[];
	dataRequirements: string[];
	interactionCapabilities: string[];
	renderTargets: string[];
	aliases: string[];
	selfClosing?: boolean;
}

export interface ComponentCapabilityCatalog {
	version: string;
	hash: string;
	components: ComponentCapabilityManifest[];
	aiAuthorableComponentIds: string[];
	chartTypes: string[];
	filterKinds: string[];
	iconNames: string[];
	blockTypes: string[];
}

export interface EditorInspectorCatalog {
	componentCatalogVersion: string;
	chartTypes: readonly string[];
	quickChartTypes: readonly string[];
	filterKinds: readonly string[];
	quickFilterKinds: readonly string[];
	metricFormats: readonly string[];
	valueFormatKinds: readonly string[];
	formatKinds: readonly string[];
}

export interface SlashComponentCatalogEntry {
	id: string;
	label: string;
	description: string;
	snippet: string;
	aliases?: string[];
}

export interface GeneratedComponentCapabilityArtifact {
	generatedAt: 'build-time';
	version: string;
	hash: string;
	catalog: ComponentCapabilityCatalog;
	editorInspector: EditorInspectorCatalog;
	slashComponents: SlashComponentCatalogEntry[];
	promptGrammar: string;
}

const CAPABILITY_OVERRIDES: Record<
	string,
	Partial<
		Pick<
			ComponentCapabilityManifest,
			| 'kind'
			| 'defaults'
			| 'constraints'
			| 'repairRules'
			| 'dataRequirements'
			| 'interactionCapabilities'
			| 'renderTargets'
			| 'aliases'
		>
	>
> = {
	metric: {
		kind: 'metric',
		defaults: { format: 'number', size: 'default', layout: 'tile' },
		dataRequirements: ['single scalar value; optional comparison value'],
		repairRules: [
			'unknown icon -> remove icon',
			'oversized pictogram -> plain metric',
			'missing format -> number'
		]
	},
	chart: {
		kind: 'data_view',
		defaults: { type: 'bar', height: 320 },
		dataRequirements: ['row array or query-cell chart ref', 'x/y fields for axis charts'],
		interactionCapabilities: ['inspect', 'compare', 'linked_highlighting'],
		aliases: [
			'plot',
			'visualization',
			'chartConfig',
			'resultChartConfig',
			'xColumn',
			'yColumn',
			'dataRef'
		],
		repairRules: [
			'chart config object -> chart props',
			'xColumn/yColumn aliases -> x/y',
			'dataRef/source aliases -> data rows',
			'invalid chart type -> default chart type',
			'missing axes -> infer from data schema when available',
			'unchartable chart -> datatable/table view'
		]
	},
	datatable: {
		kind: 'data_view',
		defaults: { pageSize: 25, headerInsights: 'compact' },
		dataRequirements: ['row array'],
		interactionCapabilities: ['inspect', 'compare', 'sort', 'page', 'export'],
		aliases: ['table', 'rows'],
		repairRules: ['missing page size -> default', 'unchartable visualization -> datatable']
	},
	filter: {
		kind: 'interaction',
		defaults: { kind: 'dropdown' },
		dataRequirements: ['parameter name; static options or options column when selectable'],
		interactionCapabilities: ['filter', 'compare', 'linked_highlighting'],
		aliases: ['control', 'slicer', 'name', 'parameter', 'controlType', 'filterType'],
		repairRules: [
			'name/parameter aliases -> param',
			'controlType/filterType aliases -> kind',
			'string options -> option array',
			'invalid filter kind -> dropdown',
			'unwired filter -> linked highlight or removal'
		]
	},
	grid: {
		kind: 'layout',
		defaults: { cols: 3, gap: 'default' },
		constraints: [
			{ class: 'repairable', rule: 'cols must be 1-4' },
			{ class: 'repairable', rule: 'grid accepts compact tiles, not large charts/tables' }
		],
		repairRules: ['chart inside grid -> move to sibling block', 'overloaded grid -> split sections']
	},
	columns: {
		kind: 'layout',
		defaults: { gap: 'default' },
		aliases: ['cols', 'items', 'children'],
		repairRules: [
			'children/items aliases -> columns',
			'wide visual compositions -> columns instead of grid'
		]
	},
	card: {
		kind: 'layout',
		defaults: { accent: 'neutral' },
		aliases: ['panel', 'box'],
		repairRules: ['children/body/content aliases -> blocks', 'unknown icon -> remove icon']
	},
	tabs: {
		kind: 'interaction',
		interactionCapabilities: ['drilldown', 'compare', 'progressive_disclosure'],
		aliases: ['sections', 'panes', 'items', 'children'],
		repairRules: ['sections/panes/items aliases -> tabs', 'empty tabs -> placeholder tab']
	},
	details: {
		kind: 'interaction',
		interactionCapabilities: ['progressive_disclosure', 'annotate'],
		aliases: ['toggle', 'accordion', 'label', 'title'],
		repairRules: ['label/title aliases -> summary', 'missing summary -> default summary']
	},
	each: {
		kind: 'logic',
		dataRequirements: ['row or item array'],
		aliases: ['forEach', 'foreach', 'repeat', 'loop', 'items', 'rows', 'source'],
		repairRules: ['items/rows/source aliases -> data rows', 'body/content aliases -> template']
	},
	group: {
		kind: 'logic',
		dataRequirements: ['row array and grouping field'],
		aliases: ['groupBy', 'column', 'field', 'rows', 'source'],
		repairRules: ['groupBy/column/field aliases -> by', 'body/content aliases -> template']
	},
	mermaid: {
		kind: 'narrative',
		dataRequirements: ['diagram code or code ref'],
		interactionCapabilities: ['explain_lineage', 'explain_flow'],
		aliases: ['diagram', 'flowchart', 'source'],
		repairRules: ['diagram alias -> code', 'source alias -> codeRef']
	},
	video: { kind: 'media' },
	embed: { kind: 'media', aliases: ['href', 'src'], repairRules: ['href/src aliases -> url'] },
	bookmark: { kind: 'media', aliases: ['href', 'src'], repairRules: ['href/src aliases -> url'] },
	math: {
		kind: 'narrative',
		aliases: ['formula', 'expression'],
		repairRules: ['formula/expression aliases -> latex']
	},
	toc: { kind: 'narrative' },
	callout: {
		kind: 'narrative',
		defaults: { type: 'info' },
		aliases: ['severity', 'tone', 'body', 'children'],
		repairRules: ['severity/tone aliases -> variant', 'children/body/content aliases -> blocks']
	},
	badge: {
		kind: 'metric',
		defaults: { color: 'neutral' },
		aliases: ['status', 'label'],
		repairRules: ['status/label aliases -> value']
	},
	progress: {
		kind: 'metric',
		defaults: { color: 'info' },
		aliases: ['current', 'total'],
		repairRules: ['current alias -> value', 'total alias -> max']
	},
	if: {
		kind: 'logic',
		interactionCapabilities: ['branch'],
		aliases: ['conditional', 'when', 'condition', 'then', 'otherwise'],
		repairRules: ['if/when aliases -> conditional', 'condition string/object -> test']
	},
	else: {
		kind: 'logic',
		interactionCapabilities: ['branch']
	}
};

const NOTEBOOK_BLUEPRINT_COMPONENTS: ComponentCapabilityManifest[] = [
	{
		id: 'text',
		kind: 'narrative',
		description: 'Markdown prose block for headings, findings, source notes, and live refs.',
		aiAuthorable: true,
		source: 'notebook-blueprint',
		propsSchema: {
			content: {
				name: 'content',
				description: 'Markdown prose; may embed live refs such as $orders.count.',
				required: true
			}
		},
		defaults: {},
		examples: ['{"type":"text","content":"# Findings\\nRevenue grew 12%."}'],
		constraints: [{ class: 'fatal', rule: 'live refs must resolve to known outputs' }],
		repairRules: ['markdown alias -> text'],
		dataRequirements: [],
		interactionCapabilities: ['annotate', 'explain'],
		renderTargets: ['notebook', 'mcp'],
		aliases: ['markdown', 'prose', 'narrative']
	},
	{
		id: 'divider',
		kind: 'layout',
		description: 'Horizontal rule that separates sections in reports and notebooks.',
		aiAuthorable: true,
		source: 'notebook-blueprint',
		propsSchema: {},
		defaults: {},
		examples: ['{"type":"divider"}'],
		constraints: [],
		repairRules: [],
		dataRequirements: [],
		interactionCapabilities: [],
		renderTargets: ['notebook', 'mcp'],
		aliases: ['rule', 'separator']
	},
	{
		id: 'queryBlock',
		kind: 'notebook',
		description: 'Places an executable SQL, PRQL, Python, or plot cell in the notebook document.',
		aiAuthorable: true,
		source: 'notebook-blueprint',
		propsSchema: {
			cellId: {
				name: 'cellId',
				description: 'Stable executable cell id matching executableCells[].cellId.',
				required: true
			},
			cellType: {
				name: 'cellType',
				description: 'Executable cell type.',
				enum: ['query', 'python', 'plot']
			},
			pinned: { name: 'pinned', description: 'Whether the query block remains visible.' }
		},
		defaults: { pinned: true, cellType: 'query' },
		examples: ['{"type":"queryBlock","cellId":"q_revenue_by_month"}'],
		constraints: [{ class: 'fatal', rule: 'cellId must match an executable or existing cell' }],
		repairRules: ['queryBlock cellType follows executableCells entry'],
		dataRequirements: ['matching executable cell or existing cell id'],
		interactionCapabilities: ['inspect', 'run', 'export'],
		renderTargets: ['notebook', 'mcp'],
		aliases: ['cell', 'query']
	},
	{
		id: 'conditional',
		kind: 'logic',
		description: 'Blueprint conditional block with then/else child blocks.',
		aiAuthorable: true,
		source: 'notebook-blueprint',
		propsSchema: {
			test: {
				name: 'test',
				description: 'Condition object: {op,left,right}.',
				required: true
			},
			then: { name: 'then', description: 'Blocks rendered when the condition is true.' },
			else: { name: 'else', description: 'Blocks rendered when the condition is false.' }
		},
		defaults: {},
		examples: [
			'{"type":"conditional","test":{"op":"gt","left":"$orders.count","right":0},"then":[{"type":"text","content":"Rows found"}]}'
		],
		constraints: [{ class: 'repairable', rule: 'test must be an object with op, left, right' }],
		repairRules: ['malformed then/else block arrays -> empty arrays'],
		dataRequirements: ['optional live refs used by condition'],
		interactionCapabilities: ['branch'],
		renderTargets: ['notebook', 'markdoc', 'mcp'],
		aliases: ['if']
	}
];

function propFromAttr(name: string, attr: MarkdocAttrCatalog): ComponentCapabilityProp {
	return {
		name,
		description: attr.detail,
		required: attr.required,
		enum: attr.enum
	};
}

function inferKind(id: string, catalog: MarkdocTagCatalogEntry): ComponentCapabilityKind {
	if (CAPABILITY_OVERRIDES[id]?.kind) return CAPABILITY_OVERRIDES[id].kind!;
	const detail = catalog.detail.toLowerCase();
	if (detail.includes('chart') || detail.includes('table')) return 'data_view';
	if (detail.includes('filter')) return 'interaction';
	if (detail.includes('layout') || detail.includes('column') || detail.includes('grid'))
		return 'layout';
	if (detail.includes('video') || detail.includes('embed') || detail.includes('link'))
		return 'media';
	return 'narrative';
}

function defaultConstraints(id: string): Array<{ class: ComponentDiagnosticClass; rule: string }> {
	const constraints: Array<{ class: ComponentDiagnosticClass; rule: string }> = [];
	if (['metric', 'card', 'callout'].includes(id)) {
		constraints.push({ class: 'repairable', rule: 'icon must come from dashboard icon allowlist' });
	}
	if (id === 'chart') {
		constraints.push({ class: 'downgradable', rule: 'chart type must be supported by runtime' });
		constraints.push({ class: 'fatal', rule: 'live refs must resolve to known outputs' });
	}
	if (id === 'filter') {
		constraints.push({ class: 'repairable', rule: 'filter kind must be supported by runtime' });
	}
	return constraints;
}

function manifestFromMarkdoc(
	id: string,
	catalog: MarkdocTagCatalogEntry
): ComponentCapabilityManifest {
	const registryEntry = getMarkdocTagRegistryEntry(id);
	const override = CAPABILITY_OVERRIDES[id] ?? {};
	const propsSchema = Object.fromEntries(
		Object.entries(catalog.attributes ?? {}).map(([name, attr]) => [name, propFromAttr(name, attr)])
	);
	return {
		id,
		kind: inferKind(id, catalog),
		description: catalog.detail,
		aiAuthorable: true,
		source: 'markdoc',
		markdocKind: registryEntry?.kind,
		propsSchema,
		defaults: override.defaults ?? {},
		examples: [catalog.snippet, catalog.slashSnippet].filter(Boolean),
		constraints: [...defaultConstraints(id), ...(override.constraints ?? [])],
		repairRules: override.repairRules ?? [],
		dataRequirements: override.dataRequirements ?? [],
		interactionCapabilities: override.interactionCapabilities ?? [],
		renderTargets: override.renderTargets ?? ['notebook', 'markdoc', 'mcp'],
		aliases: [...(catalog.aliases ?? []), ...(override.aliases ?? [])],
		selfClosing: catalog.selfClosing
	};
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function fnv1a(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

const components = [
	...NOTEBOOK_BLUEPRINT_COMPONENTS,
	...Object.entries(MARKDOC_TAG_CATALOG).map(([id, catalog]) => manifestFromMarkdoc(id, catalog))
].sort((a, b) => a.id.localeCompare(b.id));

const catalogHash = fnv1a(stableStringify(components));

export const COMPONENT_CAPABILITY_CATALOG: ComponentCapabilityCatalog = {
	version: `component-capabilities.v1.${catalogHash}`,
	hash: catalogHash,
	components,
	aiAuthorableComponentIds: components.filter((c) => c.aiAuthorable).map((c) => c.id),
	chartTypes: [...CHART_TYPES].sort(),
	filterKinds: [...FILTER_KINDS].sort(),
	iconNames: [...DASHBOARD_ICON_NAMES],
	blockTypes: [...SUPPORTED_BLOCK_TYPES].sort()
};

export const COMPONENT_CAPABILITY_MANIFESTS = COMPONENT_CAPABILITY_CATALOG.components;

function enumFor(componentId: string, propName: string): readonly string[] {
	return (
		COMPONENT_CAPABILITY_CATALOG.components.find((component) => component.id === componentId)
			?.propsSchema[propName]?.enum ?? []
	);
}

export const EDITOR_INSPECTOR_CATALOG: EditorInspectorCatalog = {
	componentCatalogVersion: COMPONENT_CAPABILITY_CATALOG.version,
	chartTypes: enumFor('chart', 'type'),
	quickChartTypes: ['line', 'bar', 'area', 'pie', 'table', 'sparkline'].filter((type) =>
		enumFor('chart', 'type').includes(type)
	),
	filterKinds: enumFor('filter', 'kind'),
	quickFilterKinds: ['dropdown', 'text-input', 'date-range', 'button-group'].filter((kind) =>
		enumFor('filter', 'kind').includes(kind)
	),
	metricFormats: enumFor('metric', 'format'),
	valueFormatKinds: enumFor('datatable', 'valueFormatKind'),
	formatKinds: [
		...new Set([
			...enumFor('metric', 'format'),
			...enumFor('datatable', 'valueFormatKind'),
			'date',
			'datetime',
			'text',
			'category',
			'boolean'
		])
	]
};

export const SLASH_COMPONENT_CATALOG: SlashComponentCatalogEntry[] =
	COMPONENT_CAPABILITY_CATALOG.components
		.filter((component) => component.source === 'markdoc' && component.aiAuthorable)
		.map((component) => {
			const source = MARKDOC_TAG_CATALOG[component.id];
			return {
				id: component.id,
				label: component.id
					.split('-')
					.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
					.join(' '),
				description: component.description,
				snippet: source?.slashSnippet ?? component.examples[0] ?? '',
				aliases: component.aliases
			};
		});

export function getComponentCapabilityCatalog(): ComponentCapabilityCatalog {
	return COMPONENT_CAPABILITY_CATALOG;
}

export function getAiAuthorableComponentIds(): string[] {
	return COMPONENT_CAPABILITY_CATALOG.aiAuthorableComponentIds;
}

export function getEditorInspectorCatalog(): EditorInspectorCatalog {
	return EDITOR_INSPECTOR_CATALOG;
}

export function getSlashComponentCatalog(): SlashComponentCatalogEntry[] {
	return SLASH_COMPONENT_CATALOG;
}

export function buildComponentCapabilityPromptBlock(): string {
	const catalog = getComponentCapabilityCatalog();
	const components = catalog.components
		.filter((component) => component.aiAuthorable)
		.map((component) => {
			const props = Object.values(component.propsSchema)
				.map((prop) => {
					const req = prop.required ? '!' : '?';
					const values = prop.enum?.length ? `=${prop.enum.join('|')}` : '';
					return `${prop.name}${req}${values}`;
				})
				.join(', ');
			const aliases = component.aliases.length ? ` aliases: ${component.aliases.join('|')}` : '';
			return `- ${component.id} [${component.kind}]${props ? ` props: ${props}` : ''}${aliases}`;
		})
		.join('\n');
	return `SELF-DESCRIBING NOTEBOOK APP COMPONENTS
Registry: ${catalog.version} (${catalog.hash})
Use create_notebook/apply_notebook_patch for mutation. Read-only helpers expose the same registry to MCP: get_component_capabilities, get_notebook_app_grammar, plan_notebook_app, repair_notebook_blueprint, score_notebook_blueprint.
AI-authorable components:
${components}
Fail-soft classes: repairable, downgradable, askable, fatal. Repairable/downgradable component/layout cleanup should be handled deterministically before asking the model to retry; unknown live refs, unsafe stg_ reporting refs, unvalidated edit actions, and answer surfaces without lineage remain fatal.`;
}

export function getGeneratedComponentCapabilityArtifact(): GeneratedComponentCapabilityArtifact {
	return {
		generatedAt: 'build-time',
		version: COMPONENT_CAPABILITY_CATALOG.version,
		hash: COMPONENT_CAPABILITY_CATALOG.hash,
		catalog: COMPONENT_CAPABILITY_CATALOG,
		editorInspector: EDITOR_INSPECTOR_CATALOG,
		slashComponents: SLASH_COMPONENT_CATALOG,
		promptGrammar: buildComponentCapabilityPromptBlock()
	};
}

export function assertComponentCapabilityCompleteness(): void {
	for (const tag of CUSTOM_MARKDOC_TAGS) {
		if (!COMPONENT_CAPABILITY_CATALOG.components.some((component) => component.id === tag)) {
			throw new Error(`Missing AI component capability manifest for custom tag: ${tag}`);
		}
	}
	for (const blockType of SUPPORTED_BLOCK_TYPES) {
		if (!COMPONENT_CAPABILITY_CATALOG.components.some((component) => component.id === blockType)) {
			throw new Error(`Missing AI component capability manifest for block type: ${blockType}`);
		}
	}
	for (const chartType of CHART_TYPES) {
		const chart = COMPONENT_CAPABILITY_CATALOG.components.find(
			(component) => component.id === 'chart'
		);
		if (!chart?.propsSchema.type?.enum?.includes(chartType)) {
			throw new Error(`Chart capability is missing runtime chart type: ${chartType}`);
		}
	}
	for (const kind of FILTER_KINDS) {
		const filter = COMPONENT_CAPABILITY_CATALOG.components.find(
			(component) => component.id === 'filter'
		);
		if (!filter?.propsSchema.kind?.enum?.includes(kind)) {
			throw new Error(`Filter capability is missing runtime filter kind: ${kind}`);
		}
	}
}
