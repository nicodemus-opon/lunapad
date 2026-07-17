<script lang="ts">
	import { Plus, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { NativeSelect } from '$lib/components/ui/native-select';
	import {
		defaultConditionalRulesForColumn,
		type ReportTableConditionalRule,
		type ThresholdOp,
		type ConditionalTone
	} from '$lib/services/report-table-conditional-format';

	interface ColumnRules {
		column: string;
		rules: ReportTableConditionalRule[];
	}

	interface Props {
		columns: string[];
		value: ColumnRules[];
		onChange: (next: ColumnRules[]) => void;
	}

	const { columns, value, onChange }: Props = $props();

	const THRESHOLD_OPS: ThresholdOp[] = ['<', '<=', '=', '!=', '>=', '>'];
	const TONES: ConditionalTone[] = ['positive', 'negative', 'warning', 'info', 'neutral'];

	let pendingColumn = $state('');

	function updateEntry(index: number, patch: Partial<ColumnRules>) {
		const next = value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
		onChange(next);
	}

	function updateThresholdRule(index: number, patch: Partial<ReportTableConditionalRule>) {
		const entry = value[index];
		const rule = entry.rules[0];
		if (!rule || rule.type !== 'threshold') return;
		updateEntry(index, { rules: [{ ...rule, ...patch }, ...entry.rules.slice(1)] });
	}

	function removeEntry(index: number) {
		onChange(value.filter((_, i) => i !== index));
	}

	function addRule() {
		const col = pendingColumn || columns[0];
		if (!col) return;
		onChange([...value, { column: col, rules: defaultConditionalRulesForColumn(col) }]);
		pendingColumn = '';
	}
</script>

<div class="cf-editor">
	<p class="cf-label">Conditional formatting</p>
	{#if value.length === 0}
		<p class="cf-hint">No rules yet — highlight cells based on their value.</p>
	{/if}
	{#each value as entry, i (entry.column + i)}
		{@const rule = entry.rules[0]}
		<div class="cf-row">
			<div class="cf-row-header">
				<span class="cf-col-name">{entry.column}</span>
				<Button
					variant="ghost"
					size="icon-xs"
					class="cf-remove"
					title="Remove rule"
					aria-label="Remove rule"
					onclick={() => removeEntry(i)}
				>
					<Trash2 class="h-3 w-3" />
				</Button>
			</div>
			{#if rule?.type === 'threshold'}
				<div class="cf-row-fields">
					<NativeSelect
						class="cf-select"
						value={rule.op}
						onchange={(e) => updateThresholdRule(i, { op: e.currentTarget.value as ThresholdOp })}
					>
						{#each THRESHOLD_OPS as op (op)}
							<option value={op}>{op}</option>
						{/each}
					</NativeSelect>
					<Input
						class="cf-input"
						value={rule.value ?? ''}
						placeholder="value"
						oninput={(e) => {
							const raw = e.currentTarget.value;
							const num = Number(raw);
							updateThresholdRule(i, { value: raw.trim() && !Number.isNaN(num) ? num : raw });
						}}
					/>
					<NativeSelect
						class="cf-select"
						value={rule.tone ?? 'neutral'}
						onchange={(e) =>
							updateThresholdRule(i, { tone: e.currentTarget.value as ConditionalTone })}
					>
						{#each TONES as tone (tone)}
							<option value={tone}>{tone}</option>
						{/each}
					</NativeSelect>
				</div>
			{:else}
				<p class="cf-hint">
					{rule?.type ?? 'Custom'} rule — edit via the source view for full control.
				</p>
			{/if}
		</div>
	{/each}
	<div class="cf-add-row">
		<NativeSelect class="cf-select" bind:value={pendingColumn}>
			<option value="">Pick a column…</option>
			{#each columns as col (col)}
				<option value={col}>{col}</option>
			{/each}
		</NativeSelect>
		<Button
			variant="outline"
			size="xs"
			class="cf-add-btn"
			onclick={addRule}
			disabled={!columns.length}
		>
			<Plus class="h-3 w-3" /> Add rule
		</Button>
	</div>
</div>

<style>
	.cf-editor {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.cf-label {
		margin: 0;
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--foreground);
	}
	.cf-hint {
		margin: 0;
		font-size: var(--text-2xs);
		line-height: 1.45;
		color: var(--muted-foreground);
	}
	:global(.cf-select),
	:global(.cf-input) {
		width: 100%;
		height: 1.55rem;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: color-mix(in oklab, var(--muted) 28%, transparent);
		color: var(--foreground);
		padding: 0 0.4rem;
		font-size: var(--text-2xs);
	}
	:global(.cf-select:hover),
	:global(.cf-input:hover) {
		background: color-mix(in oklab, var(--muted) 42%, transparent);
	}
	:global(.cf-select:focus-visible),
	:global(.cf-input:focus-visible) {
		outline: none;
		border-color: color-mix(in oklab, var(--ring) 45%, transparent);
		background: var(--background);
	}
	.cf-row {
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--muted) 18%, transparent);
		padding: 0.35rem 0.45rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.cf-row-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.cf-col-name {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-weight: 600;
	}
	:global(.cf-remove) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: var(--radius-sm);
		color: var(--muted-foreground);
	}
	:global(.cf-remove:hover) {
		background: color-mix(in oklab, var(--destructive) 12%, transparent);
		color: var(--destructive);
	}
	.cf-row-fields {
		display: grid;
		grid-template-columns: 4.5rem 1fr 5.5rem;
		gap: 0.3rem;
	}
	.cf-add-row {
		display: flex;
		gap: 0.3rem;
	}
	.cf-add-row :global(.cf-select) {
		flex: 1;
	}
	:global(.cf-add-btn) {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		white-space: nowrap;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--background);
		padding: 0 0.5rem;
		font-size: var(--text-2xs);
		color: var(--foreground);
	}
	:global(.cf-add-btn:hover:not(:disabled)) {
		border-color: var(--primary);
		background: color-mix(in oklab, var(--primary) 6%, transparent);
	}
	:global(.cf-add-btn:disabled) {
		opacity: 0.4;
		cursor: default;
	}
</style>
