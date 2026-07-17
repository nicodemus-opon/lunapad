<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { resolveSemanticToken, type SemanticTone } from './semantic-tone';

	interface Props {
		value?: string | number;
		color?: SemanticTone;
		span?: number;
	}

	const { value, color, span }: Props = $props();

	const CHART_TOKENS = [
		'var(--chart-1)',
		'var(--chart-2)',
		'var(--chart-3)',
		'var(--chart-4)',
		'var(--chart-5)'
	];

	function hashIndex(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
		return h % CHART_TOKENS.length;
	}

	const token = $derived(resolveSemanticToken(color, CHART_TOKENS[hashIndex(String(value))]));
</script>

<Badge
	variant="outline"
	class="md-badge"
	style="--md-badge-token: {token}; {span && span > 1 ? `grid-column: span ${span}` : ''}"
	>{value ?? ''}</Badge
>
