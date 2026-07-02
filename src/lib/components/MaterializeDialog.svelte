<script lang="ts">
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import {
		Loader2,
		Play,
		Database,
		CheckCircle2,
		XCircle,
		Copy,
		Trash2,
		ChevronRight
	} from '@lucide/svelte';
	import {
		materializeCell,
		materializePythonCell,
		refreshTablesFromCatalog,
		setCellDbtConfig,
		setCellDescription,
		setCellMaterializeMode,
		setCellScheduleEnabled,
		setCellScheduleIntervalMinutes,
		setCellScheduleScope,
		processScheduledMaterializations,
		getDbtModels,
		getProjectFolder,
		refreshDbtManifest,
		type Cell,
		type CellMaterializationMode,
		type CellScheduleScope
	} from '$lib/stores/notebook.svelte';
	import { coerceNumber } from '$lib/utils';
	import { dbtRun, dbtCompile, watchDbtLogs } from '$lib/services/project-client';

	interface Props {
		cell: Cell;
		isDbtProject: boolean;
		open: boolean;
	}

	let { cell, isDbtProject, open = $bindable() }: Props = $props();
	// Python cells have no compiled SQL — dbt model materialization
	// modes/settings and `dbt run --select` don't apply; "materialize" for them
	// just means "re-run and re-register the resulting table" (see
	// materializePythonCell). They keep the schedule section below unchanged.
	let isPythonCell = $derived(cell.cellType === 'python');

	let dbtRunning = $state(false);
	let dbtRunSelect = $state('');
	let dbtLogs = $state<string[]>([]);
	let dbtExitCode = $state<number | null>(null);
	let materializing = $derived(cell.materializeStatus === 'running');
	let scheduleCronInput = $state(
		untrack(() => intervalMinutesToCron(cell.scheduleIntervalMinutes))
	);
	let scheduleCronError = $state<string | null>(null);
	let logEl = $state<HTMLPreElement | undefined>();
	let showSchedule = $state(false);

	// Only reset dialog state when open transitions to true. Using untrack for cell
	// reads so that cell mutations (e.g. after refreshTablesFromCatalog) don't
	// re-run this effect while the dialog is open and wipe the log output.
	$effect(() => {
		if (open) {
			scheduleCronInput = intervalMinutesToCron(untrack(() => cell.scheduleIntervalMinutes));
			scheduleCronError = null;
			dbtRunSelect = '';
			dbtLogs = [];
			dbtExitCode = null;
			showSchedule = untrack(() => cell.scheduleEnabled);
		}
	});

	// Auto-scroll log to bottom as lines stream in.
	$effect(() => {
		if (dbtLogs.length > 0 && logEl) {
			logEl.scrollTop = logEl.scrollHeight;
		}
	});

	function intervalMinutesToCron(minutes: number): string {
		if (!Number.isFinite(minutes) || minutes < 1) return '*/15 * * * *';
		if (minutes < 60) return `*/${minutes} * * * *`;
		if (minutes % 60 === 0) return `0 */${minutes / 60} * * *`;
		return `*/${minutes} * * * *`;
	}

	function parseCronToMinutes(expr: string): number | null {
		const v = expr.trim().replace(/\s+/g, ' ');
		if (!v) return null;
		const m = v.match(/^\*\/(\d+) \* \* \* \*$/);
		if (m) {
			const n = Number(m[1]);
			return Number.isFinite(n) && n >= 1 && n <= 1440 ? n : null;
		}
		const h = v.match(/^0 \*\/(\d+) \* \* \*$/);
		if (h) {
			const n = Number(h[1]);
			return Number.isFinite(n) && n >= 1 && n <= 24 ? n * 60 : null;
		}
		return null;
	}

	function onIntervalInput(value: string) {
		const parsed = coerceNumber(value);
		if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 1) return;
		setCellScheduleIntervalMinutes(cell.id, parsed);
		scheduleCronInput = intervalMinutesToCron(parsed);
		scheduleCronError = null;
	}

	function applyCron() {
		const parsed = parseCronToMinutes(scheduleCronInput);
		if (!parsed) {
			scheduleCronError = 'Unsupported. Use */15 * * * * or 0 */2 * * *';
			return;
		}
		setCellScheduleIntervalMinutes(cell.id, parsed);
		scheduleCronInput = intervalMinutesToCron(parsed);
		scheduleCronError = null;
	}

	function formatNextRun(nextRunAt: number | null): string {
		if (!nextRunAt) return 'not scheduled';
		const ms = nextRunAt - Date.now();
		if (ms <= 0) return 'due now';
		const minutes = Math.ceil(ms / 60_000);
		if (minutes < 60) return `in ${minutes}m`;
		return `in ${Math.ceil(minutes / 60)}h`;
	}

	async function runDbtWithSelect(select: string) {
		const projectFolder = getProjectFolder();
		if (!projectFolder || !cell.outputName) return;
		dbtRunning = true;
		dbtRunSelect = select;
		dbtLogs = [];
		dbtExitCode = null;
		try {
			const inManifest = getDbtModels().some((m) => m.name === cell.outputName);
			if (!inManifest) {
				const compileJobId = await dbtCompile(projectFolder);
				await new Promise<void>((resolve) => {
					watchDbtLogs(
						compileJobId,
						() => {},
						(code) => {
							if (code === 0) void refreshDbtManifest();
							resolve();
						}
					);
				});
			}
			const jobId = await dbtRun(projectFolder, select);
			watchDbtLogs(
				jobId,
				(line) => {
					dbtLogs = [...dbtLogs, line];
				},
				(code) => {
					dbtRunning = false;
					dbtRunSelect = '';
					dbtExitCode = code;
					if (code === 0) void refreshTablesFromCatalog(true);
				}
			);
		} catch (err) {
			dbtRunning = false;
			dbtRunSelect = '';
			dbtLogs = [...dbtLogs, `Error: ${(err as Error).message ?? String(err)}`];
			dbtExitCode = -1;
		}
	}

	function copyLogs() {
		void navigator.clipboard.writeText(dbtLogs.join('\n'));
	}

	const dbtModes: CellMaterializationMode[] = ['view', 'table', 'incremental', 'ephemeral'];
	const localModes: CellMaterializationMode[] = ['table', 'view', 'incremental'];
	const modes = $derived(isDbtProject ? dbtModes : localModes);

	const modeColors: Record<string, string> = {
		table: 'bg-chart-3/10 text-chart-3 border-chart-3/30',
		view: 'bg-chart-1/10 text-chart-1 border-chart-1/30',
		incremental: 'bg-chart-2/10 text-chart-2 border-chart-2/30',
		ephemeral: 'bg-muted/50 text-muted-foreground border-muted'
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		<!-- Header -->
		<Dialog.Header>
			<Dialog.Title>{isDbtProject ? 'Deploy' : 'Materialize'}</Dialog.Title>
			{#if cell.outputName}
				<Dialog.Description class="font-mono">{cell.outputName}</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="max-h-[80vh] space-y-4 overflow-y-auto px-4 py-3">
			{#if !isPythonCell}
				<!-- Materialization mode -->
				<div class="space-y-1.5">
					<p class="text-3xs font-semibold tracking-wide text-muted-foreground uppercase">
						Materialize as
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each modes as mode}
							<button
								class="rounded border px-2.5 py-1 text-2xs font-medium transition-colors {cell.materializeMode ===
								mode
									? (modeColors[mode] ?? 'border-primary/30 bg-primary/10 text-primary')
									: 'border-border text-muted-foreground hover:bg-accent'}"
								onclick={() =>
									isDbtProject
										? setCellDbtConfig(cell.id, { materializeMode: mode })
										: setCellMaterializeMode(cell.id, mode)}
							>
								{mode}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- dbt settings -->
			{#if isDbtProject && !isPythonCell}
				<div class="space-y-1.5">
					<p class="text-3xs font-semibold tracking-wide text-muted-foreground uppercase">
						dbt settings
					</p>
					<textarea
						class="w-full resize-none rounded border border-input bg-background px-2.5 py-1.5 text-2xs placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
						placeholder="Describe this model…"
						rows={2}
						value={cell.description ?? ''}
						oninput={(e) =>
							setCellDescription(cell.id, (e.target as HTMLTextAreaElement).value || null)}
						onblur={(e) =>
							setCellDescription(cell.id, (e.target as HTMLTextAreaElement).value || null)}
					></textarea>
					<Input
						class="h-7 font-mono text-2xs"
						placeholder="Schema override"
						value={cell.dbtSchema ?? ''}
						oninput={(e) =>
							setCellDbtConfig(cell.id, {
								dbtSchema: (e.target as HTMLInputElement).value || null
							})}
					/>
					<Input
						class="h-7 font-mono text-2xs"
						placeholder="Tags (comma-separated)"
						value={cell.dbtTags?.join(', ') ?? ''}
						oninput={(e) =>
							setCellDbtConfig(cell.id, {
								dbtTags: (e.target as HTMLInputElement).value
									.split(',')
									.map((t) => t.trim())
									.filter(Boolean)
							})}
					/>
				</div>
			{/if}

			<!-- Actions -->
			<div class="space-y-1.5">
				<p class="text-3xs font-semibold tracking-wide text-muted-foreground uppercase">Run</p>
				{#if isDbtProject && !isPythonCell}
					<div class="grid grid-cols-3 gap-1.5">
						{#each [{ label: 'Model only', select: cell.outputName, title: `dbt run --select ${cell.outputName}` }, { label: 'With deps', select: '+' + cell.outputName, title: `dbt run --select +${cell.outputName}` }, { label: 'With all', select: cell.outputName + '+', title: `dbt run --select ${cell.outputName}+` }] as { label, select, title }}
							<button
								class="flex flex-col items-center gap-1 rounded border border-border px-2 py-2 text-3xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
								disabled={dbtRunning || !cell.outputName}
								{title}
								onclick={() => void runDbtWithSelect(select)}
							>
								{#if dbtRunning && dbtRunSelect === select}
									<Loader2 class="h-3 w-3 animate-spin" />
								{:else}
									<Play class="h-3 w-3 fill-current" />
								{/if}
								{label}
							</button>
						{/each}
					</div>
				{/if}
				<button
					class="flex w-full items-center gap-2 rounded border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
					disabled={materializing || cell.status === 'running'}
					onclick={async () =>
						isPythonCell ? materializePythonCell(cell.id) : materializeCell(cell.id)}
					title={isPythonCell
						? `Re-run "${cell.outputName ?? 'cell'}" and register its result table`
						: `Materialize ${cell.outputName ?? 'cell'} to database`}
				>
					{#if materializing}
						<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin" />
					{:else if cell.materializeStatus === 'success'}
						<CheckCircle2 class="h-3.5 w-3.5 shrink-0 text-success" />
					{:else}
						<Database class="h-3.5 w-3.5 shrink-0" />
					{/if}
					{#if isPythonCell}
						Re-run {cell.outputName ? `"${cell.outputName}"` : 'cell'} &amp; register table
					{:else}
						Materialize {cell.outputName ? `"${cell.outputName}"` : 'cell'} locally
					{/if}
				</button>
			</div>

			<!-- dbt run log output -->
			{#if dbtLogs.length > 0 || dbtRunning}
				<div class="space-y-1">
					<div class="flex items-center justify-between">
						<p class="text-3xs font-semibold tracking-wide text-muted-foreground uppercase">
							Output
						</p>
						<div class="flex items-center gap-1.5">
							{#if dbtExitCode !== null}
								<span
									class="flex items-center gap-1 text-3xs font-medium {dbtExitCode === 0
										? 'text-success'
										: 'text-destructive'}"
								>
									{#if dbtExitCode === 0}
										<CheckCircle2 class="h-3 w-3" />
									{:else}
										<XCircle class="h-3 w-3" />
									{/if}
									{dbtExitCode === 0 ? 'Success' : `Exit ${dbtExitCode}`}
								</span>
							{/if}
							{#if dbtLogs.length > 0}
								<button
									class="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
									title="Copy output"
									onclick={copyLogs}
								>
									<Copy class="h-3 w-3" />
								</button>
								<button
									class="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
									title="Clear output"
									onclick={() => {
										dbtLogs = [];
										dbtExitCode = null;
									}}
								>
									<Trash2 class="h-3 w-3" />
								</button>
							{/if}
						</div>
					</div>
					<pre
						bind:this={logEl}
						class="max-h-48 overflow-y-auto rounded border border-border bg-muted/40 px-2.5 py-2 font-mono text-3xs leading-relaxed break-all whitespace-pre-wrap">{dbtLogs.join(
							'\n'
						)}{#if dbtRunning}
							▌{/if}</pre>
				</div>
			{/if}

			<!-- Schedule (progressive disclosure) -->
			<div class="space-y-2">
				<button
					type="button"
					class="flex w-full items-center gap-1.5 text-3xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
					onclick={() => (showSchedule = !showSchedule)}
				>
					<ChevronRight class="h-3 w-3 transition-transform {showSchedule ? 'rotate-90' : ''}" />
					Auto-materialize
					{#if cell.scheduleEnabled}
						<span class="rounded bg-primary/10 px-1.5 py-0.5 text-3xs text-primary normal-case"
							>On</span
						>
					{/if}
				</button>

				{#if showSchedule}
					<div class="flex items-center justify-between">
						<span class="text-2xs text-muted-foreground">Enable schedule</span>
						<button
							class="rounded border px-2 py-0.5 text-2xs font-medium transition-colors {cell.scheduleEnabled
								? 'border-primary/30 bg-primary/10 text-primary'
								: 'border-border text-muted-foreground hover:bg-accent'}"
							onclick={() => setCellScheduleEnabled(cell.id, !cell.scheduleEnabled)}
						>
							{cell.scheduleEnabled ? 'On' : 'Off'}
						</button>
					</div>
					<div class="flex items-center gap-2">
						<span class="shrink-0 text-2xs text-muted-foreground">Every</span>
						<Input
							type="number"
							min="1"
							max="1440"
							value={String(cell.scheduleIntervalMinutes)}
							class="h-7 text-xs"
							onchange={(e) => onIntervalInput((e.target as HTMLInputElement).value)}
							disabled={!cell.scheduleEnabled}
						/>
						<span class="shrink-0 text-2xs text-muted-foreground">min</span>
					</div>
					<div class="flex items-center gap-1.5">
						<span class="shrink-0 text-2xs text-muted-foreground">Cron</span>
						<Input
							value={scheduleCronInput}
							class="h-7 font-mono text-xs"
							placeholder="*/15 * * * *"
							oninput={(e) => {
								scheduleCronInput = (e.target as HTMLInputElement).value;
								scheduleCronError = null;
							}}
							disabled={!cell.scheduleEnabled}
						/>
						<Button
							variant="outline"
							size="sm"
							class="h-7 shrink-0 px-2 text-2xs"
							onclick={applyCron}
							disabled={!cell.scheduleEnabled}
						>
							Apply
						</Button>
					</div>
					{#if scheduleCronError}
						<p class="text-3xs text-destructive">{scheduleCronError}</p>
					{/if}
					<div class="flex items-center gap-1">
						{#each ['cell', 'segment'] as scope}
							<button
								class="rounded border px-2.5 py-1 text-2xs transition-colors {cell.scheduleScope ===
								scope
									? 'border-border bg-accent text-foreground'
									: 'border-transparent text-muted-foreground hover:bg-accent/50'}"
								disabled={!cell.scheduleEnabled}
								onclick={() => setCellScheduleScope(cell.id, scope as CellScheduleScope)}
							>
								{scope}
							</button>
						{/each}
						<button
							class="ml-auto rounded border border-border px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:bg-accent"
							onclick={async () => processScheduledMaterializations()}
						>
							Run due
						</button>
					</div>
					<p class="text-3xs text-muted-foreground">
						Next run: {formatNextRun(cell.scheduleNextRunAt)}
					</p>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
