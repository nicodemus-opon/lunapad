export type MarkdocTagKind = 'leaf' | 'container';

export interface MarkdocTagRegistryEntry {
	kind: MarkdocTagKind;
	selfClosing?: boolean;
	runtime: 'custom' | 'builtin';
}

export const MARKDOC_TAG_REGISTRY = {
	metric: { kind: 'leaf', selfClosing: true, runtime: 'custom' },
	chart: { kind: 'leaf', selfClosing: true, runtime: 'custom' },
	datatable: { kind: 'leaf', selfClosing: true, runtime: 'custom' },
	badge: { kind: 'leaf', selfClosing: true, runtime: 'custom' },
	progress: { kind: 'leaf', selfClosing: true, runtime: 'custom' },
	filter: { kind: 'leaf', selfClosing: true, runtime: 'custom' },
	columns: { kind: 'container', runtime: 'custom' },
	column: { kind: 'container', runtime: 'custom' },
	grid: { kind: 'container', runtime: 'custom' },
	callout: { kind: 'container', runtime: 'custom' },
	card: { kind: 'container', runtime: 'custom' },
	details: { kind: 'container', runtime: 'custom' },
	tabs: { kind: 'container', runtime: 'custom' },
	tab: { kind: 'container', runtime: 'custom' },
	mermaid: { kind: 'container', runtime: 'custom' },
	group: { kind: 'container', runtime: 'custom' },
	each: { kind: 'container', runtime: 'custom' },
	if: { kind: 'container', runtime: 'builtin' },
	else: { kind: 'leaf', selfClosing: true, runtime: 'builtin' }
} as const satisfies Record<string, MarkdocTagRegistryEntry>;

export const MARKDOC_CONTAINER_TAGS = new Set(
	Object.entries(MARKDOC_TAG_REGISTRY)
		.filter(([, entry]) => entry.kind === 'container')
		.map(([tagName]) => tagName)
);

export const MARKDOC_LEAF_WIDGET_TAGS = new Set(
	Object.entries(MARKDOC_TAG_REGISTRY)
		.filter(([, entry]) => entry.kind === 'leaf' && entry.runtime === 'custom')
		.map(([tagName]) => tagName)
);

export const CUSTOM_MARKDOC_TAGS = Object.freeze(
	Object.entries(MARKDOC_TAG_REGISTRY)
		.filter(([, entry]) => entry.runtime === 'custom')
		.map(([tagName]) => tagName)
);

export function getMarkdocTagRegistryEntry(tagName: string): MarkdocTagRegistryEntry | null {
	return MARKDOC_TAG_REGISTRY[tagName as keyof typeof MARKDOC_TAG_REGISTRY] ?? null;
}

export function isMarkdocContainerTag(tagName: string): boolean {
	return MARKDOC_CONTAINER_TAGS.has(tagName);
}

export function isMarkdocLeafWidgetTag(tagName: string): boolean {
	return MARKDOC_LEAF_WIDGET_TAGS.has(tagName);
}

export function isSelfClosingMarkdocTag(tagName: string): boolean {
	return getMarkdocTagRegistryEntry(tagName)?.selfClosing === true;
}

export function isStructuredMarkdocContainerTag(
	tagName: string,
	options: { selfClosing?: boolean } = {}
): boolean {
	if (options.selfClosing) return false;
	const entry = getMarkdocTagRegistryEntry(tagName);
	if (entry) return entry.kind === 'container';
	return true;
}
