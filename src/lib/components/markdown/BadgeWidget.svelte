<script lang="ts">
	interface Props {
		value?: string | number;
		color?: 'info' | 'success' | 'warning' | 'error' | 'neutral';
	}

	const { value, color }: Props = $props();

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

	const token = $derived.by(() => {
		switch (color) {
			case 'info':
				return 'var(--chart-1)';
			case 'success':
				return 'var(--success)';
			case 'warning':
				return 'var(--warning)';
			case 'error':
				return 'var(--destructive)';
			case 'neutral':
				return 'var(--foreground)';
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
		border-radius: var(--radius);
		font-size: var(--text-xs);
		font-weight: 600;
		line-height: 1.4;
		background: color-mix(in oklab, var(--md-badge-token) 8%, transparent);
		border: 1px solid color-mix(in oklab, var(--md-badge-token) 25%, transparent);
		color: var(--md-badge-token);
		margin: 0.1rem 0.15rem;
		vertical-align: middle;
	}
</style>
