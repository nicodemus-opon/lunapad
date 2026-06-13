<script lang="ts">
	import type {
		DeriveStage,
		DeriveColumn,
		DeriveOperand,
		DeriveExprBinary,
		DeriveExprFunc,
		DeriveExprFString,
		DeriveExprSString,
		DeriveExprRaw,
		ExprOp,
		ExprFunc
	} from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { ColumnInput } from '$lib/components/ui/column-input';
	import { pickDeriveColumn } from '$lib/components/gui/chip-intelligence';
	import { GripVertical } from '@lucide/svelte';
	import {
		PRQL_FUNCTION_REGISTRY,
		LEGACY_PRQL_FUNCTION_ALIASES
	} from '$lib/constants/prql-functions';
	import { Plus, X } from '@lucide/svelte';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { CHIP, CHIP_ADD, CHIP_META, CHIP_X } from '../chip-styles';

	const EXPR_MODE_ICON: Record<string, string> = {
		binary: '±',
		func: 'ƒ()',
		fstring: 'f"',
		sstring: 's"',
		raw: '</>'
	};

	interface Props {
		stage: DeriveStage;
		availableColumns: string[];
		onUpdate: (stage: DeriveStage) => void;
		/** Set of chip indices (stage.columns indices) that have compile errors. */
		erroredChipIndices?: ReadonlySet<number>;
	}

	let { stage, availableColumns, onUpdate, erroredChipIndices }: Props = $props();

	type ExprMode = 'binary' | 'func' | 'fstring' | 'sstring' | 'raw';
	type FuncCategory = 'common' | 'math' | 'text' | 'date';

	interface FuncArgSpec {
		label: string;
		placeholder: string;
		defaultKind: DeriveOperand['kind'];
		defaultValue?: string;
	}

	interface FuncOption {
		value: ExprFunc;
		label: string;
		category: FuncCategory;
		detail: string;
		args: FuncArgSpec[];
	}

	const MODE_BUTTONS: { value: ExprMode; label: string; testid: string }[] = [
		{ value: 'binary', label: 'a ⊕ b', testid: 'mode-binary' },
		{ value: 'func', label: 'f(x)', testid: 'mode-func' },
		{ value: 'fstring', label: 'f""', testid: 'mode-fstring' },
		{ value: 'sstring', label: 's""', testid: 'mode-sstring' },
		{ value: 'raw', label: 'expr', testid: 'mode-raw' }
	];

	const BINARY_OPS: { value: ExprOp; label: string }[] = [
		{ value: '+', label: '+ add' },
		{ value: '-', label: '− subtract' },
		{ value: '*', label: '× multiply' },
		{ value: '/', label: '÷ divide' },
		{ value: '||', label: '|| concat' }
	];

	const FUNC_CATEGORIES: { value: FuncCategory; label: string }[] = [
		{ value: 'common', label: 'Common' },
		{ value: 'math', label: 'Math' },
		{ value: 'text', label: 'Text' },
		{ value: 'date', label: 'Date' }
	];

	const FUNC_OPTIONS: FuncOption[] = PRQL_FUNCTION_REGISTRY;

	const LEGACY_FUNC_ALIASES: Partial<Record<ExprFunc, ExprFunc>> = LEGACY_PRQL_FUNCTION_ALIASES;

	function canonicalizeFunc(func: ExprFunc): ExprFunc {
		return LEGACY_FUNC_ALIASES[func] ?? func;
	}

	function getFuncOption(func: ExprFunc): FuncOption {
		return FUNC_OPTIONS.find((option) => option.value === canonicalizeFunc(func)) ?? FUNC_OPTIONS[0];
	}

	function getFuncCategory(func: ExprFunc): FuncCategory {
		return getFuncOption(func).category;
	}

	function optionsForCategory(category: FuncCategory): FuncOption[] {
		return FUNC_OPTIONS.filter((option) => option.category === category);
	}

	function defaultOperand(spec: FuncArgSpec): DeriveOperand {
		return spec.defaultKind === 'column'
			? { kind: 'column', value: availableColumns[0] ?? '' }
			: { kind: 'literal', value: spec.defaultValue ?? '' };
	}

	function createFuncExpr(func: ExprFunc): DeriveExprFunc {
		const option = getFuncOption(func);
		return {
			mode: 'func',
			func: option.value,
			args: option.args.map(defaultOperand)
		};
	}

	function getFuncArgs(expr: DeriveExprFunc): DeriveOperand[] {
		const maybeExpr = expr as DeriveExprFunc & { arg?: DeriveOperand };
		if (Array.isArray(maybeExpr.args)) return maybeExpr.args;
		if (maybeExpr.arg) return [maybeExpr.arg];
		return createFuncExpr(expr.func).args;
	}

	function humanizeOperand(op: DeriveOperand): string {
		return op.kind === 'column' ? (op.value || '?') : `"${op.value}"`;
	}

	// ── Humanize ────────────────────────────────────────────────────────────
	function humanizeExpr(expr: DeriveColumn['expr']): string {
		if (expr.mode === 'binary') {
			const l = expr.left.kind === 'column' ? (expr.left.value || '?') : `"${expr.left.value}"`;
			const r = expr.right.kind === 'column' ? (expr.right.value || '?') : `"${expr.right.value}"`;
			return `${l} ${expr.op} ${r}`;
		}
		if (expr.mode === 'func') {
			const option = getFuncOption(expr.func);
			const args = getFuncArgs(expr).map(humanizeOperand).join(', ');
			return args.length > 0 ? `${option.label.replace('()', '')}(${args})` : option.label;
		}
		if (expr.mode === 'fstring') return expr.template ? `f"""${expr.template}"""` : 'f"""…"""';
		if (expr.mode === 'sstring') return expr.template ? `s"""${expr.template}"""` : 's"""…"""';
		if (expr.mode === 'raw') return expr.expr || '…';
		return '?';
	}

	function humanizeCol(col: DeriveColumn): string {
		return `${col.name || '?'} = ${humanizeExpr(col.expr)}`;
	}

	// ── Mutations ────────────────────────────────────────────────────────────
	function addColumn() {
		const leftCol = pickDeriveColumn(availableColumns);
		// Auto-generate a unique name so the chip is immediately useful
		const baseName = leftCol ? `new_${leftCol}` : 'new_col';
		const usedNames = new Set(stage.columns.map((c) => c.name));
		let name = baseName;
		let n = 2;
		while (usedNames.has(name)) name = `${baseName}_${n++}`;

		const col: DeriveColumn = {
			name,
			expr: {
				mode: 'binary',
				left: { kind: 'column', value: leftCol },
				op: '+',
				right: { kind: 'literal', value: '0' }
			}
		};
		onUpdate({ ...stage, columns: [...stage.columns, col] });
	}

	function removeCol(idx: number) {
		onUpdate({ ...stage, columns: stage.columns.filter((_, i) => i !== idx) });
	}

	function updateColName(idx: number, name: string) {
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => (i === idx ? { ...c, name } : c)) });
	}

	function setMode(idx: number, mode: ExprMode) {
		let expr: DeriveColumn['expr'];
		if (mode === 'binary') {
			expr = { mode: 'binary', left: { kind: 'column', value: availableColumns[0] ?? '' }, op: '+', right: { kind: 'literal', value: '0' } } satisfies DeriveExprBinary;
		} else if (mode === 'func') {
			expr = createFuncExpr('coalesce') satisfies DeriveExprFunc;
		} else if (mode === 'fstring') {
			expr = { mode: 'fstring', template: '' } satisfies DeriveExprFString;
		} else if (mode === 'sstring') {
			expr = { mode: 'sstring', template: '' } satisfies DeriveExprSString;
		} else {
			expr = { mode: 'raw', expr: '' } satisfies DeriveExprRaw;
		}
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => (i === idx ? { ...c, expr } : c)) });
	}

	function setBinaryLeftCol(idx: number, value: string) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'binary') return;
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, left: { kind: 'column', value } } } : c) });
	}
	function setBinaryLeftLiteral(idx: number, value: string) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'binary') return;
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, left: { kind: 'literal', value } } } : c) });
	}
	function setBinaryRightCol(idx: number, value: string) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'binary') return;
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, right: { kind: 'column', value } } } : c) });
	}
	function setBinaryRightLiteral(idx: number, value: string) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'binary') return;
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, right: { kind: 'literal', value } } } : c) });
	}
	function setBinaryOp(idx: number, op: ExprOp) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'binary') return;
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, op } } : c) });
	}
	function toggleBinaryLeftKind(idx: number) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'binary') return;
		const left = col.expr.left.kind === 'column' ? { kind: 'literal' as const, value: '' } : { kind: 'column' as const, value: availableColumns[0] ?? '' };
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, left } } : c) });
	}
	function toggleBinaryRightKind(idx: number) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'binary') return;
		const right = col.expr.right.kind === 'column' ? { kind: 'literal' as const, value: '' } : { kind: 'column' as const, value: availableColumns[0] ?? '' };
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, right } } : c) });
	}
	function updateFuncArg(idx: number, argIdx: number, nextArg: DeriveOperand) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'func') return;
		const fexpr = col.expr;
		const args = [...getFuncArgs(fexpr)];
		args[argIdx] = nextArg;
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...fexpr, func: canonicalizeFunc(fexpr.func), args } } : c) });
	}
	function setFuncArgCol(idx: number, argIdx: number, value: string) {
		updateFuncArg(idx, argIdx, { kind: 'column', value });
	}
	function setFuncArgLiteral(idx: number, argIdx: number, value: string) {
		updateFuncArg(idx, argIdx, { kind: 'literal', value });
	}
	function toggleFuncArgKind(idx: number, argIdx: number) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'func') return;
		const option = getFuncOption(col.expr.func);
		const currentArg = getFuncArgs(col.expr)[argIdx] ?? defaultOperand(option.args[argIdx]);
		const spec = option.args[argIdx];
		const nextArg = currentArg.kind === 'column'
			? { kind: 'literal' as const, value: spec?.defaultValue ?? '' }
			: { kind: 'column' as const, value: availableColumns[0] ?? '' };
		updateFuncArg(idx, argIdx, nextArg);
	}
	function setFunc(idx: number, func: ExprFunc) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'func') return;
		const expr = createFuncExpr(func);
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr } : c) });
	}
	function setFuncCategory(idx: number, category: FuncCategory) {
		const nextFunc = optionsForCategory(category)[0]?.value;
		if (!nextFunc) return;
		setFunc(idx, nextFunc);
	}
	function setTemplate(idx: number, template: string) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'fstring' && col.expr.mode !== 'sstring') return;
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, template } } : c) });
	}
	function setRawExpr(idx: number, expr: string) {
		const col = stage.columns[idx];
		if (col.expr.mode !== 'raw') return;
		onUpdate({ ...stage, columns: stage.columns.map((c, i) => i === idx ? { ...c, expr: { ...col.expr, expr } } : c) });
	}

	// ── Drag-to-reorder columns ──────────────────────────────────────────────
	let dragColIdx = $state<number | null>(null);

	function reorderCols(from: number, to: number) {
		const columns = [...stage.columns];
		const [moved] = columns.splice(from, 1);
		columns.splice(to, 0, moved);
		onUpdate({ ...stage, columns });
	}
</script>



<div class="flex items-center gap-1.5 flex-wrap" role="list" aria-label="Derived columns">
	{#if stage.columns.length === 0}
		<span class="text-xs text-muted-foreground/60 italic">no columns</span>
	{/if}

	{#each stage.columns as col, idx (`${col.name}-${idx}`)}
		<div
			role="listitem"
			draggable="true"
			ondragstart={(e) => { if (!(e.target as HTMLElement).closest('[data-drag-handle]')) { e.preventDefault(); return; } dragColIdx = idx; }}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => { e.preventDefault(); if (dragColIdx !== null && dragColIdx !== idx) { reorderCols(dragColIdx, idx); dragColIdx = null; } }}
			ondragend={() => (dragColIdx = null)}
			class={CHIP}
			class:err-chip={erroredChipIndices?.has(idx)}
			class:opacity-40={dragColIdx !== null && dragColIdx === idx}
		>
			<!-- Drag handle — only spot dragging can start from -->
			<span
				data-drag-handle
				class="flex h-full shrink-0 cursor-grab items-center pl-1 pr-0.5 text-muted-foreground/20 transition-colors duration-150 hover:text-muted-foreground/50 active:cursor-grabbing"
				title="Drag to reorder"
			><GripVertical class="w-3 h-3" /></span>

			<!-- Mode selector — click to switch expression type -->
			<select
				value={col.expr.mode}
				class="h-full shrink-0 cursor-pointer bg-transparent px-1 font-mono text-2xs text-muted-foreground/60 outline-none transition-colors duration-150 hover:text-foreground"
				title="Expression type"
				onchange={(e) => setMode(idx, (e.target as HTMLSelectElement).value as ExprMode)}
			>
				{#each MODE_BUTTONS as btn (btn.value)}
					<option value={btn.value}>{btn.label}</option>
				{/each}
			</select>

			{#if col.expr.mode === 'binary'}
				<!-- ── Binary mode: fully inline smart chip ── -->
				{@const bexpr = col.expr}
				<!-- Output name -->
				<InlineChipLabel
					value={col.name}
					placeholder="name…"
					class="px-1.5 py-1 font-mono text-xs"
					oncommit={(v) => updateColName(idx, v)}
				/>
				<span class="{CHIP_META} px-0.5">=</span>
				<!-- Left operand -->
				<button
					class="select-none px-1 font-mono text-2xs text-muted-foreground/60 transition-colors duration-150 hover:text-foreground"
					onclick={() => toggleBinaryLeftKind(idx)}
					title="Toggle column / literal"
				>{bexpr.left.kind === 'column' ? 'col' : 'lit'}</button>
				{#if bexpr.left.kind === 'column'}
					<InlineChipLabel
						value={bexpr.left.value}
						suggestions={availableColumns}
						placeholder="col…"
						class="px-1.5 py-1 font-mono text-xs"
						oncommit={(v) => setBinaryLeftCol(idx, v)}
					/>
				{:else}
					<InlineChipLabel
						value={bexpr.left.value}
						placeholder="val…"
						class="px-1.5 py-1 font-mono text-xs"
						oncommit={(v) => setBinaryLeftLiteral(idx, v)}
					/>
				{/if}
				<!-- Op dropdown -->
				<select
					value={bexpr.op}
					class="h-full cursor-pointer bg-transparent px-0.5 font-mono text-xs text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground"
					onchange={(e) => setBinaryOp(idx, (e.target as HTMLSelectElement).value as ExprOp)}
				>
					{#each BINARY_OPS as op (op.value)}
						<option value={op.value}>{op.value}</option>
					{/each}
				</select>
				<!-- Right operand -->
				<button
					class="select-none px-1 font-mono text-2xs text-muted-foreground/60 transition-colors duration-150 hover:text-foreground"
					onclick={() => toggleBinaryRightKind(idx)}
					title="Toggle column / literal"
				>{bexpr.right.kind === 'column' ? 'col' : 'lit'}</button>
				{#if bexpr.right.kind === 'column'}
					<InlineChipLabel
						value={bexpr.right.value}
						suggestions={availableColumns}
						placeholder="col…"
						class="px-1.5 py-1 font-mono text-xs"
						oncommit={(v) => setBinaryRightCol(idx, v)}
					/>
				{:else}
					<InlineChipLabel
						value={bexpr.right.value}
						placeholder="val…"
						class="px-1.5 py-1 font-mono text-xs"
						oncommit={(v) => setBinaryRightLiteral(idx, v)}
					/>
				{/if}
			{:else}
				<!-- ── Non-binary: name inline + expression via popover ── -->
				<InlineChipLabel
					value={col.name}
					placeholder="name…"
					class="px-1.5 py-1 font-mono text-xs"
					oncommit={(v) => updateColName(idx, v)}
				/>
				<span class="{CHIP_META} px-0.5">=</span>
				<Popover.Root>
				<Popover.Trigger class="inline-flex h-full items-center px-1.5 font-mono text-muted-foreground/80 transition-colors duration-150 hover:bg-muted/60 hover:text-foreground">
					{humanizeExpr(col.expr)}
				</Popover.Trigger>
				<Popover.Content class="w-72 p-0 overflow-hidden">
					<!-- Body: expression type + fields -->
					<div class="px-3 py-3 space-y-3">
						<!-- Mode segmented control -->
						<div>
							<p class="text-2xs font-medium text-muted-foreground mb-1.5">Expression type</p>
							<div class="flex rounded-md border overflow-hidden w-full">
								{#each MODE_BUTTONS as btn (btn.value)}
									<button
										type="button"
										class="flex-1 py-1 text-xs font-mono border-r last:border-r-0 transition-colors duration-150
											{col.expr.mode === btn.value
											? 'bg-primary text-primary-foreground'
											: 'bg-background text-muted-foreground hover:bg-muted/50'}"
										onclick={() => setMode(idx, btn.value as ExprMode)}
										data-testid={btn.testid}
									>{btn.label}</button>
								{/each}
							</div>
						</div>

						<!-- Expression fields (binary is handled inline — popover only for non-binary modes) -->
						{#if col.expr.mode === 'func'}
							{@const fexpr = col.expr}
							{@const activeCategory = getFuncCategory(fexpr.func)}
							{@const activeFunction = getFuncOption(fexpr.func)}
							{@const functionOptions = optionsForCategory(activeCategory)}
							{@const fargs = getFuncArgs(fexpr)}
							<div class="space-y-2">
								<div>
									<p class="text-2xs font-medium text-muted-foreground mb-1">Category</p>
									<div class="grid grid-cols-4 rounded-md border overflow-hidden">
										{#each FUNC_CATEGORIES as category (category.value)}
											<button
												type="button"
												class="py-1 text-xs font-mono border-r last:border-r-0 transition-colors duration-150
													{activeCategory === category.value
													? 'bg-primary text-primary-foreground'
													: 'bg-background text-muted-foreground hover:bg-muted/50'}"
												onclick={() => setFuncCategory(idx, category.value)}
											>{category.label}</button>
										{/each}
									</div>
								</div>
								<div>
									<p class="text-2xs font-medium text-muted-foreground mb-1">Function</p>
									<Select.Root
										type="single"
										value={activeFunction.value}
										onValueChange={(v) => setFunc(idx, v as ExprFunc)}
									>
										<Select.Trigger class="h-7 text-xs w-full">
											{activeFunction.label}
										</Select.Trigger>
										<Select.Content>
											{#each functionOptions as f (f.value)}
												<Select.Item value={f.value} class="text-xs">{f.label}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
									<p class="mt-1 text-2xs leading-relaxed text-muted-foreground">{activeFunction.detail}</p>
								</div>
								{#if activeFunction.args.length === 0}
									<div class="rounded-md border border-dashed border-border/70 bg-muted/20 px-2.5 py-2 text-xs text-muted-foreground">
										This function inserts a value directly, no inputs required.
									</div>
								{:else}
									{#each activeFunction.args as argSpec, argIdx (`${activeFunction.value}-${argIdx}-${argSpec.label}`)}
										{@const arg = fargs[argIdx] ?? defaultOperand(argSpec)}
										<div>
											<p class="text-2xs font-medium text-muted-foreground mb-1">{argSpec.label}</p>
											<div class="flex gap-1.5 items-center">
												<button
													class="text-2xs px-1.5 py-0.5 rounded border shrink-0 transition-colors duration-150
														{arg.kind === 'column' ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground border-border/70 hover:bg-muted/40 hover:text-foreground'}"
													onclick={() => toggleFuncArgKind(idx, argIdx)}
													title="Toggle column / literal"
												>{arg.kind === 'column' ? 'col' : 'lit'}</button>
												{#if arg.kind === 'column'}
													<ColumnInput
														class="flex-1"
														value={arg.value}
														suggestions={availableColumns}
														data-testid={`derive-func-arg-${argIdx}`}
														onchange={(v) => setFuncArgCol(idx, argIdx, v)}
													/>
												{:else}
													<Input
														class="h-7 text-xs font-mono flex-1"
														placeholder={argSpec.placeholder}
														value={arg.value}
														oninput={(e) => setFuncArgLiteral(idx, argIdx, (e.target as HTMLInputElement).value)}
													/>
												{/if}
											</div>
										</div>
									{/each}
								{/if}
							</div>

						{:else if col.expr.mode === 'fstring'}
							{@const fsexpr = col.expr}
							<div>
								<p class="text-2xs font-medium text-muted-foreground mb-1">Template</p>
								<div class="flex items-center gap-1">
									<span class="text-xs font-mono text-primary shrink-0">f"""</span>
									<Input
										class="h-7 text-xs font-mono flex-1"
										placeholder={'{c.col1}, {c.col2}…'}
										value={fsexpr.template}
										data-testid="derive-fstring-template"
										oninput={(e) => setTemplate(idx, (e.target as HTMLInputElement).value)}
									/>
									<span class="text-xs font-mono text-primary shrink-0">"""</span>
								</div>
							</div>

						{:else if col.expr.mode === 'sstring'}
							{@const ssexpr = col.expr}
							<div>
								<p class="text-2xs font-medium text-muted-foreground mb-1">SQL template</p>
								<div class="flex items-center gap-1">
									<span class="text-xs font-mono text-warning shrink-0">s"""</span>
									<Input
										class="h-7 text-xs font-mono flex-1"
										placeholder="raw SQL expression…"
										value={ssexpr.template}
										data-testid="derive-sstring-template"
										oninput={(e) => setTemplate(idx, (e.target as HTMLInputElement).value)}
									/>
									<span class="text-xs font-mono text-warning shrink-0">"""</span>
								</div>
							</div>

						{:else if col.expr.mode === 'raw'}
							{@const rawexpr = col.expr}
							<div>
								<p class="text-2xs font-medium text-muted-foreground mb-1">Expression</p>
								<ColumnInput
									class="w-full"
									value={rawexpr.expr}
									suggestions={availableColumns}
									placeholder="any PRQL expression…"
									data-testid="derive-raw-expr"
									onchange={(v) => setRawExpr(idx, v)}
								/>
							</div>
						{/if}
					</div>
				</Popover.Content>
			</Popover.Root>
			{/if}<!-- end binary/non-binary -->
			<button
				class={CHIP_X}
				onclick={() => removeCol(idx)}
				aria-label="Remove column"
			>
				<X class="w-3 h-3" />
			</button>
		</div>
	{/each}

	<!-- Add column -->
	<button class={CHIP_ADD} onclick={addColumn} aria-label="Add derived column">
		<Plus class="w-3 h-3" />
	</button>
</div>

<style>
	.err-chip {
		border-color: hsl(var(--destructive) / 0.4) !important;
		background-color: hsl(var(--destructive) / 0.08) !important;
		color: hsl(var(--destructive)) !important;
	}
</style>
