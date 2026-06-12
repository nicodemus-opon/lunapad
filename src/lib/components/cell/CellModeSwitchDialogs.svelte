<script lang="ts">
	import { Button } from '$lib/components/ui/button';

	let {
		confirmSwitchToGui = $bindable(false),
		confirmSwitchToSql = $bindable(false),
		confirmSwitchToPrql = $bindable(false),
		onSwitchToGui,
		onSwitchToSql,
		onSwitchToPrql
	}: {
		confirmSwitchToGui?: boolean;
		confirmSwitchToSql?: false | 'with-code' | 'without-code';
		confirmSwitchToPrql?: boolean;
		onSwitchToGui: () => void;
		onSwitchToSql: (useCompiledCode: boolean) => void;
		onSwitchToPrql: () => void;
	} = $props();
</script>

<!-- Confirm: switch PRQL → GUI (will discard manual code) -->
{#if confirmSwitchToGui}
	<div class="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/40">
		<div class="mx-4 w-full max-w-sm space-y-3 rounded-lg border bg-card p-5 shadow-xl">
			<p class="text-sm font-semibold">Switch to GUI mode?</p>
			<p class="text-xs text-muted-foreground">
				This PRQL cannot be parsed into GUI stages. Switching now will discard it and replace it
				with a blank pipeline. This cannot be undone.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="outline" size="sm" onclick={() => (confirmSwitchToGui = false)}
					>Cancel</Button
				>
				<Button size="sm" onclick={onSwitchToGui}>Switch to GUI</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Confirm: switch PRQL → SQL -->
{#if confirmSwitchToSql}
	<div class="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/40">
		<div class="mx-4 w-full max-w-sm space-y-3 rounded-lg border bg-card p-5 shadow-xl">
			{#if confirmSwitchToSql === 'with-code'}
				<p class="text-sm font-semibold">Convert PRQL to SQL?</p>
				<p class="text-xs text-muted-foreground">
					PRQL compiled successfully. Use the generated SQL as this cell's code, or switch to SQL
					mode keeping the current code as-is.
				</p>
				<div class="flex justify-end gap-2">
					<Button variant="outline" size="sm" onclick={() => (confirmSwitchToSql = false)}
						>Cancel</Button
					>
					<Button variant="outline" size="sm" onclick={() => onSwitchToSql(false)}
						>Keep PRQL code</Button
					>
					<Button size="sm" onclick={() => onSwitchToSql(true)}>Use compiled SQL</Button>
				</div>
			{:else}
				<p class="text-sm font-semibold">Switch to SQL?</p>
				<p class="text-xs text-muted-foreground">
					This PRQL couldn't be compiled — it may use features that don't translate directly. Switch
					to SQL anyway? The code will be kept as-is.
				</p>
				<div class="flex justify-end gap-2">
					<Button variant="outline" size="sm" onclick={() => (confirmSwitchToSql = false)}
						>Cancel</Button
					>
					<Button size="sm" onclick={() => onSwitchToSql(false)}>Switch to SQL</Button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Confirm: switch SQL → PRQL -->
{#if confirmSwitchToPrql}
	<div class="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/40">
		<div class="mx-4 w-full max-w-sm space-y-3 rounded-lg border bg-card p-5 shadow-xl">
			<p class="text-sm font-semibold">Switch to PRQL?</p>
			<p class="text-xs text-muted-foreground">
				SQL cannot be automatically converted to PRQL. The existing code will be kept as-is and may
				have syntax errors in PRQL mode.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="outline" size="sm" onclick={() => (confirmSwitchToPrql = false)}
					>Cancel</Button
				>
				<Button size="sm" onclick={onSwitchToPrql}>Switch to PRQL</Button>
			</div>
		</div>
	</div>
{/if}
