/** Markdoc container tags that accept nested block content in visual mode. */
export const MARKDOC_CONTAINER_TAGS = new Set([
	'columns',
	'column',
	'grid',
	'callout',
	'card',
	'details',
	'tabs',
	'tab',
	'mermaid',
	'each',
	'group',
	'if'
]);

/** Self-closing or leaf Markdoc widgets (no nested PM content). */
export const MARKDOC_LEAF_WIDGET_TAGS = new Set([
	'metric',
	'chart',
	'datatable',
	'badge',
	'progress',
	'filter'
]);

export function isMarkdocContainerTag(tagName: string): boolean {
	return MARKDOC_CONTAINER_TAGS.has(tagName);
}

export function isMarkdocLeafWidgetTag(tagName: string): boolean {
	return MARKDOC_LEAF_WIDGET_TAGS.has(tagName);
}

export function parseAttrsJson(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}
