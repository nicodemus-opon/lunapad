<script lang="ts">
	let { sql }: { sql: string } = $props();
</script>

<div class="rounded-md border bg-muted/50 p-3">
	<p class="mb-1.5 text-xs font-medium text-muted-foreground">Generated SQL</p>
	<pre class="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-foreground/80">{sql}</pre>
</div>
