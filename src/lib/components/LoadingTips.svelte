<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Loader2 } from '@lucide/svelte';
	import Logo from '$lib/assets/logo.svelte';

	const TIPS: string[] = [
		'Write PRQL or SQL — cells reference each other by name and chain into CTEs automatically.',
		'Drag and drop pipeline stages in the GUI editor — no PRQL required.',
		'"Promote to dbt model" turns a notebook cell into a real .prql or .sql file dbt can run.',
		'Upload a CSV and promote it to a dbt seed in a couple of clicks.',
		'The lineage view shows how every model in your project connects.',
		'Python cells share a warm worker and come with real autocomplete.',
		'Chart cells render with Plotly — bar, line, scatter, and more.',
		'Press Cmd+K on a cell to ask AI to write or fix it inline.',
		'.luna notebooks mix prose and query cells in one document, in order.',
		'Connect Postgres, ClickHouse, or Trino and query them like any other table.',
		'The command palette (Cmd+Shift+P) reaches almost everything without a mouse.',
		'Leave inline comments on cells for review, just like a pull request.',
		'Schedule dbt runs so your models refresh on their own.',
		'The AI agent remembers project context across sessions in .lunapad/memory.',
		'Switch a cell between GUI and PRQL editing without losing your pipeline.',
		'Results render as table, chart, or stats — pick whichever tells the story best.',
		'Notebooks support callouts, kanban boards, tables, and progress bars, not just text.',
		'Mermaid diagrams and math render live right inside a markdown cell.',
		'Backlinks show which other notebooks reference this one, Obsidian-style.',
		'Every result table comes with column stats: histograms, box plots, and top values.',
		'Share a notebook as a report page with its own filter bar for stakeholders.',
		'GUI stages cover filter, join, group, window, sort, and take — no PRQL required.',
		'Start a new notebook from the template gallery instead of a blank page.',
		'Manage Postgres, ClickHouse, and Trino connections from Settings — no config files.',
		'Install Python packages for your cells right from the settings panel.',
		'Data quality hints flag nulls, outliers, and skew as you profile a column.',
		'Leave threaded review comments on a cell, then resolve them from the review panel.',
		'The AI agent proposes a diff before it edits your notebook — you approve the change.',
		'Publish a notebook as a site others can browse without opening the editor.',
		'Run dbt tests straight from the dbt panel — no terminal required.',
		'Invite teammates and manage roles from Team Settings.'
	];

	let index = $state(Math.floor(Math.random() * TIPS.length));

	$effect(() => {
		const id = setInterval(() => {
			index = (index + 1) % TIPS.length;
		}, 6000);
		return () => clearInterval(id);
	});
</script>

<div class="flex flex-col items-center gap-8">
	<div class="relative flex h-16 w-16 items-center justify-center">
		<Loader2 class="absolute h-16 w-16 animate-spin text-muted-foreground/20" strokeWidth={1.5} />
		<Logo class="h-6 w-6 text-primary" />
	</div>
	<div class="flex h-10 max-w-sm flex-col items-center gap-2 px-6 text-center">
		<span class="text-[10px] font-medium tracking-[0.2em] text-muted-foreground/50 uppercase"
			>Tip</span
		>
		{#key index}
			<p class="text-sm text-muted-foreground" in:fade={{ duration: 300 }}>{TIPS[index]}</p>
		{/key}
	</div>
</div>
