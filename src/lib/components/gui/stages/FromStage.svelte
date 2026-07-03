<script lang="ts">
	import type { FromStage } from '$lib/types/gui-pipeline';
	import { ChipInput } from '$lib/components/ui/chip-input';
	import { CHIP_META } from '../chip-styles';

	interface Props {
		stage: FromStage;
		availableTables: string[];
		onUpdate: (stage: FromStage) => void;
	}

	let { stage, availableTables, onUpdate }: Props = $props();

	const CELL_OUTPUTS_SCHEMA = '__cell_outputs__';

	function splitSourceName(name: string): { schema: string; table: string } {
		const idx = name.indexOf('.');
		if (idx === -1) return { schema: CELL_OUTPUTS_SCHEMA, table: name };
		return { schema: name.slice(0, idx), table: name.slice(idx + 1) };
	}

	const entries = $derived(availableTables.map((name) => ({ name, ...splitSourceName(name) })));

	const schemaOptions = $derived.by(() => {
		const out: string[] = [];
		for (const e of entries) {
			if (!out.includes(e.schema)) out.push(e.schema);
		}
		return out.sort((a, b) => {
			if (a === CELL_OUTPUTS_SCHEMA) return -1;
			if (b === CELL_OUTPUTS_SCHEMA) return 1;
			return a.localeCompare(b);
		});
	});

	const hasMultipleSchemas = $derived(schemaOptions.length > 1);

	const selectedSchema = $derived.by(() => {
		if (!stage.table) return '';
		const parsed = splitSourceName(stage.table);
		return schemaOptions.includes(parsed.schema) ? parsed.schema : '';
	});

	const selectedTableName = $derived.by(() => {
		if (!stage.table) return '';
		return splitSourceName(stage.table).table;
	});

	const tablesForSchema = $derived(
		selectedSchema ? entries.filter((e) => e.schema === selectedSchema) : entries
	);

	const tableSuggestions = $derived(
		selectedSchema ? tablesForSchema.map((e) => e.table) : tablesForSchema.map((e) => e.name)
	);

	const schemaSuggestions = $derived(
		schemaOptions.map((s) => (s === CELL_OUTPUTS_SCHEMA ? 'cell outputs' : s))
	);

	function schemaLabel(s: string) {
		return s === CELL_OUTPUTS_SCHEMA ? 'cell outputs' : s;
	}

	function normalizeSchema(raw: string): string {
		const t = raw.trim().toLowerCase();
		if (!t) return '';
		if (t === 'cell outputs') return CELL_OUTPUTS_SCHEMA;
		return schemaOptions.find((s) => s.toLowerCase() === t) ?? raw.trim();
	}

	function onSchemaInput(raw: string): void {
		const schema = normalizeSchema(raw);
		if (!schema) {
			onUpdate({ ...stage, table: '' });
			return;
		}
		if (!schemaOptions.includes(schema)) return;
		const matching = entries.filter((e) => e.schema === schema);
		const preserved = matching.find((e) => e.table === selectedTableName);
		onUpdate({ ...stage, table: preserved?.name ?? matching[0]?.name ?? '' });
	}

	function onTableInput(rawTable: string): void {
		const t = rawTable.trim();
		if (!t) {
			onUpdate({ ...stage, table: '' });
			return;
		}

		if (selectedSchema) {
			const found = entries.find(
				(e) => e.schema === selectedSchema && (e.table === t || e.name === t)
			);
			const sourceName = selectedSchema === CELL_OUTPUTS_SCHEMA ? t : `${selectedSchema}.${t}`;
			onUpdate({ ...stage, table: found?.name ?? sourceName });
		} else {
			const found = entries.find((e) => e.name === t || e.table === t);
			onUpdate({ ...stage, table: found?.name ?? t });
		}
	}
</script>

<!--
  FROM chip: schema + table inline with ChipInput autocomplete.
  Schema column only shown when multiple schemas are available.
-->
<div
	class="stage-chip group/from inline-flex h-6 shrink-0 items-center overflow-visible rounded border font-mono text-xs transition-colors duration-(--motion-fast)
		{stage.table
		? 'border-border bg-background'
		: 'border-dashed border-border text-muted-foreground'}"
>
	{#if stage.alias}
		<ChipInput
			value={stage.alias}
			placeholder="alias…"
			class="py-1 pr-0.5 pl-2 font-mono text-muted-foreground/70"
			oninput={(v) => onUpdate({ ...stage, alias: v || undefined })}
			oncommit={(v) => onUpdate({ ...stage, alias: v.trim() || undefined })}
		/>
		<span class="{CHIP_META} pr-0.5">=</span>
	{/if}

	{#if hasMultipleSchemas}
		<ChipInput
			value={selectedSchema ? schemaLabel(selectedSchema) : ''}
			suggestions={schemaSuggestions}
			placeholder="schema…"
			class="py-1 pl-2.5 font-mono text-muted-foreground/60"
			oninput={onSchemaInput}
			oncommit={onSchemaInput}
		/>
		<span class={CHIP_META}>.</span>
	{/if}

	<ChipInput
		value={selectedTableName}
		suggestions={tableSuggestions}
		placeholder={hasMultipleSchemas ? 'table…' : 'select source…'}
		class="{hasMultipleSchemas ? 'pr-2.5' : 'px-2.5'} py-1 font-mono {stage.table
			? ''
			: 'text-muted-foreground'}"
		oninput={onTableInput}
		oncommit={onTableInput}
	/>

	<!-- Alias toggle (hover-only, for when alias isn't set) -->
	{#if !stage.alias}
		<button
			class="flex h-full items-center px-1.5 text-2xs text-muted-foreground/50 opacity-0 transition-[opacity,color,background-color] duration-(--motion-fast) group-hover/from:opacity-100 hover:bg-muted/60 hover:text-muted-foreground"
			onclick={() => onUpdate({ ...stage, alias: stage.table?.slice(0, 1) || 't' })}
			title="Add alias">≡</button
		>
	{/if}
</div>
