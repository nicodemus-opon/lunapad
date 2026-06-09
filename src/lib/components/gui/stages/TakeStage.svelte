<script lang="ts">
	import type { TakeStage } from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';

	interface Props {
		stage: TakeStage;
		onUpdate: (stage: TakeStage) => void;
	}

	let { stage, onUpdate }: Props = $props();

	const isRange = $derived(stage.rangeFrom !== undefined);

	const label = $derived(
		isRange ? `${stage.rangeFrom}..${stage.n}` : `${stage.n}`
	);

	function decrement() {
		if (isRange) return;
		const next = Math.max(1, stage.n - 10);
		onUpdate({ ...stage, n: next });
	}

	function increment() {
		if (isRange) return;
		onUpdate({ ...stage, n: stage.n + 10 });
	}

	function setN(v: string) {
		const n = parseInt(v, 10);
		if (!isNaN(n) && n > 0) onUpdate({ ...stage, n });
	}

	function setRangeFrom(v: string) {
		const from = parseInt(v, 10);
		if (!isNaN(from) && from > 0) onUpdate({ ...stage, rangeFrom: from });
	}

	function setRangeTo(v: string) {
		const n = parseInt(v, 10);
		if (!isNaN(n) && n > 0) onUpdate({ ...stage, n });
	}

	function toggleRange() {
		if (isRange) {
			onUpdate({ ...stage, rangeFrom: undefined });
		} else {
			onUpdate({ ...stage, rangeFrom: 1 });
		}
	}

	// inline edit state
	let editing = $state(false);
	let numberInputEl = $state<HTMLInputElement | undefined>();

	$effect(() => {
		if (editing && numberInputEl) {
			numberInputEl.focus();
			numberInputEl.select();
		}
	});
</script>

<div
	class="inline-flex items-center rounded border  bg-background text-xs overflow-hidden shrink-0 group/take"
>
	{#if isRange}
		<!-- Range mode: keep popover for range inputs -->
		<Popover.Root>
			<Popover.Trigger class="px-2.5 py-1 font-mono hover:bg-muted/90 transition-colors">
				{label} rows
			</Popover.Trigger>
			<Popover.Content class="w-52 p-3 space-y-3">
				<div>
					<p class="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">From</p>
					<Input
						type="number"
						min="1"
						class="h-7 text-xs font-mono w-full"
						value={stage.rangeFrom}
						oninput={(e) => setRangeFrom((e.target as HTMLInputElement).value)}
					/>
				</div>
				<div>
					<p class="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">To</p>
					<Input
						type="number"
						min="1"
						class="h-7 text-xs font-mono w-full"
						value={stage.n}
						oninput={(e) => setRangeTo((e.target as HTMLInputElement).value)}
					/>
				</div>
				<button
					class="w-full h-7 rounded border text-xs transition-colors bg-muted/50 hover:bg-muted text-muted-foreground"
					onclick={toggleRange}
				>
					Switch to limit
				</button>
			</Popover.Content>
		</Popover.Root>
	{:else}
		<!-- Limit mode: inline ±  stepper -->
		<button
			class="px-1.5 py-1 text-muted-foreground opacity-0 group-hover/take:opacity-100 hover:text-foreground hover:bg-muted/60 transition-all select-none"
			onclick={decrement}
			aria-label="Decrease by 10"
		>−</button>

		{#if editing}
			<input
				bind:this={numberInputEl}
				type="number"
				min="1"
				value={stage.n}
				size={Math.max(2, String(stage.n).length + 1)}
				class="font-mono bg-transparent outline-none text-center px-1 py-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				oninput={(e) => setN((e.target as HTMLInputElement).value)}
				onblur={() => (editing = false)}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') editing = false; }}
			/>
		{:else}
			<button
				class="font-mono px-1 py-1 hover:bg-muted/60 transition-colors tabular-nums"
				onclick={() => (editing = true)}
				title="Click to edit"
			>
				{label}
			</button>
		{/if}

		<span class="py-1 pr-1 text-muted-foreground/70 select-none">rows</span>

		<button
			class="px-1.5 py-1 text-muted-foreground opacity-0 group-hover/take:opacity-100 hover:text-foreground hover:bg-muted/60 transition-all select-none"
			onclick={increment}
			aria-label="Increase by 10"
		>+</button>

		<!-- ⋯ opens range/limit toggle -->
		<Popover.Root>
			<Popover.Trigger
				class="px-1.5 py-1 text-muted-foreground/50 opacity-0 group-hover/take:opacity-100 hover:text-muted-foreground transition-all border-l border-border/50"
				title="Switch to range mode"
			>⋯</Popover.Trigger>
			<Popover.Content class="w-44 p-3">
				<button
					class="w-full h-7 rounded border text-xs transition-colors bg-muted/50 hover:bg-muted text-muted-foreground"
					onclick={toggleRange}
				>
					Switch to range
				</button>
			</Popover.Content>
		</Popover.Root>
	{/if}
</div>
