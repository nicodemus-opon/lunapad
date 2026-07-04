<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';

	let {
		confirmSwitchToGui = $bindable(false),
		confirmSwitchToSql = $bindable(false),
		confirmSwitchToPrql = $bindable(false),
		confirmSwitchToVisualMarkdown = $bindable(false),
		onSwitchToGui,
		onSwitchToSql,
		onSwitchToPrql,
		onSwitchToVisualMarkdown
	}: {
		confirmSwitchToGui?: boolean;
		confirmSwitchToSql?: false | 'with-code' | 'without-code';
		confirmSwitchToPrql?: boolean;
		confirmSwitchToVisualMarkdown?: boolean;
		onSwitchToGui: () => void;
		onSwitchToSql: (useCompiledCode: boolean) => void;
		onSwitchToPrql: () => void;
		onSwitchToVisualMarkdown?: () => void;
	} = $props();
</script>

<Dialog.Root bind:open={confirmSwitchToGui}>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>Switch to GUI mode?</Dialog.Title>
			<Dialog.Description class="leading-relaxed">
				This PRQL cannot be parsed into GUI stages. Switching now will discard it and replace it
				with a blank pipeline. This cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (confirmSwitchToGui = false)}
				>Cancel</Button
			>
			<Button size="sm" onclick={onSwitchToGui}>Switch to GUI</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={confirmSwitchToSql !== false}
	onOpenChange={(open) => {
		if (!open) confirmSwitchToSql = false;
	}}
>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		{#if confirmSwitchToSql === 'with-code'}
			<Dialog.Header>
				<Dialog.Title>Convert PRQL to SQL?</Dialog.Title>
				<Dialog.Description class="leading-relaxed">
					PRQL compiled successfully. Use the generated SQL as this cell's code, or switch to SQL
					mode keeping the current code as-is.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" size="sm" onclick={() => (confirmSwitchToSql = false)}
					>Cancel</Button
				>
				<Button variant="outline" size="sm" onclick={() => onSwitchToSql(false)}
					>Keep PRQL code</Button
				>
				<Button size="sm" onclick={() => onSwitchToSql(true)}>Use compiled SQL</Button>
			</Dialog.Footer>
		{:else if confirmSwitchToSql === 'without-code'}
			<Dialog.Header>
				<Dialog.Title>Switch to SQL?</Dialog.Title>
				<Dialog.Description class="leading-relaxed">
					This PRQL couldn't be compiled — it may use features that don't translate directly.
					Switch to SQL anyway? The code will be kept as-is.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" size="sm" onclick={() => (confirmSwitchToSql = false)}
					>Cancel</Button
				>
				<Button size="sm" onclick={() => onSwitchToSql(false)}>Switch to SQL</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={confirmSwitchToPrql}>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>Switch to PRQL?</Dialog.Title>
			<Dialog.Description class="leading-relaxed">
				SQL cannot be automatically converted to PRQL. The existing code will be kept as-is and may
				have syntax errors in PRQL mode.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (confirmSwitchToPrql = false)}
				>Cancel</Button
			>
			<Button size="sm" onclick={onSwitchToPrql}>Switch to PRQL</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={confirmSwitchToVisualMarkdown}>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>Switch to Visual mode?</Dialog.Title>
			<Dialog.Description class="leading-relaxed">
				Some Markdoc may not map cleanly to visual blocks yet. Unknown sections stay as editable
				source slices inside the canvas.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (confirmSwitchToVisualMarkdown = false)}
				>Cancel</Button
			>
			<Button size="sm" onclick={() => onSwitchToVisualMarkdown?.()}>Switch to Visual</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
