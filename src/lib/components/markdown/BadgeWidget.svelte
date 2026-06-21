<script lang="ts">
	interface Props {
		value?: string | number;
		color?: 'info' | 'success' | 'warning' | 'error' | 'neutral';
	}

	const { value, color }: Props = $props();

	const CHART_TOKENS = ['var(--chart-1, #3b82f6)', 'var(--chart-2, #16a34a)', 'var(--chart-3, #d97706)', 'var(--chart-4, #8b5cf6)', 'var(--chart-5, #0ea5e9)'];

	function hashIndex(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
		return h % CHART_TOKENS.length;
	}

	const token = $derived.by(() => {
		switch (color) {
			case 'info':
				return 'var(--chart-1, #3b82f6)';
			case 'success':
				return 'var(--chart-2, #16a34a)';
			case 'warning':
				return '#d97706';
			case 'error':
				return 'var(--destructive, #dc2626)';
			case 'neutral':
				return 'var(--foreground, #1a1a1a)';
			default:
				return CHART_TOKENS[hashIndex(String(value))];
		}
	});
</script>

<span class="md-badge" style="--md-badge-token: {token}">{value}</span>

<style>
	.md-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.55rem;
		border-radius: 0.395rem;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.4;
		background: color-mix(in oklch, var(--md-badge-token) 8%, transparent);
		border: 1px solid color-mix(in oklch, var(--md-badge-token) 25%, transparent);
		color: var(--md-badge-token);
		margin: 0.1rem 0.15rem;
		vertical-align: middle;
	}
</style>
