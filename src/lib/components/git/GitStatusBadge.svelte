<script lang="ts">
	import { cn } from '$lib/utils.js';

	let {
		status,
		class: className
	}: { status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?'; class?: string } = $props();

	const COLOR: Record<string, string> = {
		M: 'text-warning',
		A: 'text-success',
		D: 'text-destructive',
		R: 'text-chart-2',
		C: 'text-chart-2',
		U: 'text-destructive',
		'?': 'text-muted-foreground/50'
	};

	const LABEL: Record<string, string> = {
		M: 'Modified',
		A: 'Added',
		D: 'Deleted',
		R: 'Renamed',
		C: 'Copied',
		U: 'Unmerged (conflict)',
		'?': 'Untracked'
	};
</script>

<span
	class={cn(
		'w-3 shrink-0 text-center font-mono text-3xs font-semibold',
		COLOR[status] ?? 'text-muted-foreground',
		className
	)}
	title={LABEL[status] ?? status}
>
	{status}
</span>
