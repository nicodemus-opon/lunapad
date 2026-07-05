import { normalizeMarkdocAttrs } from '$lib/services/markdoc-ast';
export {
	MARKDOC_CONTAINER_TAGS,
	MARKDOC_LEAF_WIDGET_TAGS,
	isMarkdocContainerTag,
	isMarkdocLeafWidgetTag
} from '$lib/services/markdoc-tag-registry';

export function parseAttrsJson(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return normalizeMarkdocAttrs(parsed as Record<string, unknown>);
	} catch {
		return {};
	}
}
