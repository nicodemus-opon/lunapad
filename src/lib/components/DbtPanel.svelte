<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		Zap,
		Play,
		RefreshCcw,
		ChevronDown,
		ChevronRight,
		X,
		CheckCircle2,
		XCircle,
		Minus,
		FlaskConical,
		BookOpen,
		Network,
		Loader2,
		Plus,
		Pencil,
		Trash2,
		Clock
	} from '@lucide/svelte';
	import {
		getProjectFolder,
		getDbtModels,
		getDbtRunningJobId,
		getDbtLastCompileAt,
		refreshDbtManifest,
		setDbtRunningJobId,
		openLineageTab,
		getDbtSchedules,
		loadDbtSchedules,
		saveDbtSchedule,
		deleteDbtSchedule
	} from '$lib/stores/notebook.svelte';
	import { dbtCompile, dbtRun, dbtTest, watchDbtLogs } from '$lib/services/project-client';
	import type { DbtModel } from '$lib/server/dbt';
	import type { DbtSchedule } from '$lib/types/schedule';
	import DbtScheduleModal from './DbtScheduleModal.svelte';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import EmptyState from '$lib/components/sidebar/EmptyState.svelte';

	const projectFolder = $derived(getProjectFolder());
	const dbtModels = $derived(getDbtModels());
	const runningJobId = $derived(getDbtRunningJobId());
	const lastCompileAt = $derived(getDbtLastCompileAt());
	const schedules = $derived(getDbtSchedules());

	let expanded = $state(false);
	let schedulesExpanded = $state(false);
	let logLines = $state<string[]>([]);
	let logHeader = $state('');
	let logOpen = $state(false);
	let exitCode = $state<number | null>(null);
	let logUnsubscribe: (() => void) | null = null;

	// Schedule modal state
	let modalOpen = $state(false);
	let editingSchedule = $state<Partial<DbtSchedule> | null>(null);

	// Track which schedule job is currently running (for inline status)
	let runningScheduleId = $state<string | null>(null);

	// Poll schedule last-run status from server while a schedule is running
	let schedulePollTimer: ReturnType<typeof setTimeout> | null = null;

	function startSchedulePoll() {
		if (schedulePollTimer) return;
		schedulePollTimer = setInterval(() => void loadDbtSchedules(), 5_000);
	}

	function stopSchedulePoll() {
		if (schedulePollTimer) {
			clearInterval(schedulePollTimer);
			schedulePollTimer = null;
		}
	}

	// Watch for scheduled runs starting via SSE (server-sent events from scheduleEvents).
	// We reuse the /api/dbt/logs SSE stream once the scheduled job fires, identified by
	// checking if lastRunJobId changed.
	let prevJobIds = $state<Record<string, string | null>>({});

	// Background poll: refresh schedules every 30 s so the UI picks up runs fired
	// by the Inngest scheduler without any user interaction.
	$effect(() => {
		if (!projectFolder) return;
		const timer = setInterval(() => void loadDbtSchedules(), 30_000);
		return () => clearInterval(timer);
	});

	// Node selector state
	let selectorInput = $state('');
	let selectorFocused = $state(false);
	let selectorHighlight = $state(-1);

	const selectorSuggestions = $derived.by(() => {
		const q = selectorInput.trim().toLowerCase();
		if (!q) return [];
		const modelNames = dbtModels.map((m) => m.name);
		const tags = [
			...new Set(dbtModels.flatMap((m) => (m as DbtModel & { tags?: string[] }).tags ?? []))
		];
		const tagSuggestions = tags.map((t) => `tag:${t}`);
		return [...modelNames, ...tagSuggestions]
			.filter((s) => s.toLowerCase().includes(q))
			.slice(0, 6);
	});

	function relativeTime(ts: number): string {
		const diffMs = Date.now() - ts;
		const diffMin = Math.round(diffMs / 60_000);
		if (diffMin < 1) return 'just now';
		if (diffMin === 1) return '1m ago';
		return `${diffMin}m ago`;
	}

	function logLineClass(line: string): string {
		if (/\[ERROR\]|ERROR|FAIL|failed/i.test(line)) return 'text-destructive';
		if (/\[OK\]|PASS|success|Completed/i.test(line)) return 'text-success';
		if (/WARN|warning/i.test(line)) return 'text-warning';
		return 'text-muted-foreground';
	}

	async function runCommand(fn: () => Promise<string>, label: string) {
		if (!projectFolder) return;
		logLines = [];
		logHeader = label;
		exitCode = null;
		logOpen = true;
		logUnsubscribe?.();

		try {
			const jobId = await fn();
			setDbtRunningJobId(jobId);
			logUnsubscribe = watchDbtLogs(
				jobId,
				(line) => {
					logLines = [...logLines, line];
				},
				(code) => {
					exitCode = code;
					setDbtRunningJobId(null);
					if (code === 0) {
						toast.success(`${label} completed`);
						void refreshDbtManifest();
					} else {
						toast.error(`${label} failed (exit ${code})`);
					}
				}
			);
		} catch (err) {
			toast.error((err as Error).message ?? `${label} failed`);
			setDbtRunningJobId(null);
		}
	}

	function modelStatusIcon(model: DbtModel) {
		if (model.lastRunStatus === 'pass') return { icon: CheckCircle2, class: 'text-success' };
		if (model.lastRunStatus === 'error') return { icon: XCircle, class: 'text-destructive' };
		return { icon: Minus, class: 'text-muted-foreground/40' };
	}

	// Group models by schema
	const modelsBySchema = $derived.by(() => {
		const groups = new Map<string, DbtModel[]>();
		for (const m of dbtModels) {
			const schema = m.schema || 'default';
			if (!groups.has(schema)) groups.set(schema, []);
			groups.get(schema)!.push(m);
		}
		return groups;
	});

	function relativeNextRun(cron: string): string {
		// Quick approximation: check the next-run time via the last-computed nextRun stored on
		// server by re-using the existing PUT endpoint. For now show a static label.
		// A reactive $effect would over-fetch; we compute once on render from cron string.
		return '';
	}

	function nextRunLabel(schedule: DbtSchedule): string {
		// Parse common cron patterns into readable text as a lightweight hint.
		// For full accuracy users see the modal's preview.
		const parts = schedule.cron.trim().split(/\s+/);
		if (parts.length !== 5) return '';
		const [min, hour, dom, month, dow] = parts;
		if (dom === '*' && month === '*' && dow === '*') {
			if (min !== '*' && hour !== '*')
				return `daily ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
			if (min !== '*' && hour === '*') return `every hour :${min.padStart(2, '0')}`;
			if (min === '*' && hour === '*') return 'every min';
		}
		if (dow !== '*' && dom === '*') return `weekly`;
		return schedule.cron;
	}

	async function handleToggleSchedule(schedule: DbtSchedule) {
		try {
			await saveDbtSchedule({ ...schedule, enabled: !schedule.enabled });
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to update schedule');
		}
	}

	async function handleDeleteSchedule(id: string) {
		try {
			await deleteDbtSchedule(id);
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to delete schedule');
		}
	}

	async function handleSaveSchedule(schedule: DbtSchedule) {
		try {
			await saveDbtSchedule(schedule);
			modalOpen = false;
			editingSchedule = null;
			toast.success(schedule.id ? 'Schedule saved' : 'Schedule created');
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to save schedule');
		}
	}

	function openAddModal() {
		editingSchedule = {};
		modalOpen = true;
	}

	function openEditModal(schedule: DbtSchedule) {
		editingSchedule = { ...schedule };
		modalOpen = true;
	}

	// Watch schedules for new lastRunJobId → open the log drawer automatically
	$effect(() => {
		for (const s of schedules) {
			const prev = prevJobIds[s.id];
			if (s.lastRunJobId && s.lastRunJobId !== prev) {
				// A new scheduled run started — open log drawer
				prevJobIds = { ...prevJobIds, [s.id]: s.lastRunJobId };
				const jobId = s.lastRunJobId;
				const label = `${s.label} (scheduled)`;
				logLines = [];
				logHeader = label;
				exitCode = null;
				logOpen = true;
				logUnsubscribe?.();
				runningScheduleId = s.id;
				setDbtRunningJobId(jobId);
				startSchedulePoll();
				logUnsubscribe = watchDbtLogs(
					jobId,
					(line) => {
						logLines = [...logLines, line];
					},
					(code) => {
						exitCode = code;
						setDbtRunningJobId(null);
						runningScheduleId = null;
						stopSchedulePoll();
						void loadDbtSchedules();
						if (code === 0) {
							toast.success(`${label} completed`);
							void refreshDbtManifest();
						} else {
							toast.error(`${label} failed (exit ${code})`);
						}
					}
				);
			}
		}
	});

	function handleSelectorKey(e: KeyboardEvent) {
		if (!selectorSuggestions.length) return;
		if (e.key === 'ArrowDown') {
			selectorHighlight = (selectorHighlight + 1) % selectorSuggestions.length;
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			selectorHighlight =
				(selectorHighlight - 1 + selectorSuggestions.length) % selectorSuggestions.length;
			e.preventDefault();
		} else if (e.key === 'Enter' && selectorHighlight >= 0) {
			selectorInput = selectorSuggestions[selectorHighlight];
			selectorHighlight = -1;
			selectorFocused = false;
		} else if (e.key === 'Escape') {
			selectorFocused = false;
		}
	}
</script>

<div class="border-t border-border">
	<!-- Section header -->
	<div class="flex h-9 shrink-0 items-center border-b border-border px-2">
		<button
			class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
			onclick={() => (expanded = !expanded)}
		>
			{#if expanded}
				<ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			{:else}
				<ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			{/if}
			<span class="text-2xs font-medium text-muted-foreground">dbt</span>
			{#if runningJobId}
				<span class="ml-1 inline-flex items-center gap-1 text-2xs text-muted-foreground">
					<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-chart-1"></span>
					running
				</span>
			{:else if lastCompileAt}
				<span class="ml-1 text-2xs text-muted-foreground">{relativeTime(lastCompileAt)}</span>
			{/if}
		</button>
		<!-- Action buttons -->
		<div class="flex items-center gap-0.5">
			<button
				class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-40"
				title="View lineage"
				onclick={() => openLineageTab()}
			>
				<Network class="h-3.5 w-3.5" />
			</button>
			<button
				class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-40"
				title="Compile"
				disabled={!!runningJobId || !projectFolder}
				onclick={() => runCommand(() => dbtCompile(projectFolder!), 'Compile')}
			>
				<Zap class="h-3.5 w-3.5" />
			</button>
			<button
				class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-40"
				title="Refresh manifest"
				disabled={!!runningJobId || !projectFolder}
				onclick={() => void refreshDbtManifest()}
			>
				<RefreshCcw class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>

	{#if expanded}
		<!-- Node selector -->
		<div class="relative px-2 pb-2">
			<div class="relative">
				<input
					class="w-full rounded border border-input bg-background px-2 py-1 pr-5 font-mono text-2xs placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
					placeholder="Selector (e.g. +model, tag:…)"
					bind:value={selectorInput}
					onfocus={() => {
						selectorFocused = true;
						selectorHighlight = -1;
					}}
					onblur={() =>
						setTimeout(() => {
							selectorFocused = false;
						}, 150)}
					onkeydown={handleSelectorKey}
				/>
				{#if selectorInput}
					<button
						class="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						onclick={() => {
							selectorInput = '';
							selectorHighlight = -1;
						}}
					>
						<X class="h-3 w-3" />
					</button>
				{/if}
			</div>
			<!-- Autocomplete dropdown -->
			{#if selectorFocused && selectorSuggestions.length > 0}
				<div
					class="absolute top-full right-2 left-2 z-(--z-dropdown) mt-0.5 rounded border border-border bg-popover shadow-md"
				>
					{#each selectorSuggestions as suggestion, i}
						<button
							class="flex w-full items-center px-2 py-1 font-mono text-2xs hover:bg-accent {i ===
							selectorHighlight
								? 'bg-accent'
								: ''}"
							onmousedown={() => {
								selectorInput = suggestion;
								selectorFocused = false;
							}}>{suggestion}</button
						>
					{/each}
				</div>
			{/if}
			<!-- Run / Test with selector -->
			<div class="mt-1.5 flex gap-1">
				<button
					class="flex flex-1 items-center justify-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-2xs transition-colors hover:bg-accent disabled:opacity-40"
					disabled={!!runningJobId || !projectFolder}
					onclick={() =>
						runCommand(
							() => dbtRun(projectFolder!, selectorInput || undefined),
							selectorInput ? `Run ${selectorInput}` : 'Run all'
						)}
				>
					{#if runningJobId}
						<Loader2 class="h-3 w-3 animate-spin" />
					{:else}
						<Play class="h-3 w-3" />
					{/if}
					{selectorInput ? `Run ${selectorInput}` : 'Run all'}
				</button>
				<button
					class="flex flex-1 items-center justify-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-2xs transition-colors hover:bg-accent disabled:opacity-40"
					disabled={!!runningJobId || !projectFolder}
					onclick={() =>
						runCommand(
							() => dbtTest(projectFolder!, selectorInput || undefined),
							selectorInput ? `Test ${selectorInput}` : 'Test all'
						)}
				>
					<FlaskConical class="h-3 w-3" />
					{selectorInput ? `Test ${selectorInput}` : 'Test all'}
				</button>
			</div>
		</div>

		<!-- Model list -->
		{#if dbtModels.length === 0}
			<EmptyState description="No models found. Run dbt compile to load the manifest.">
				{#snippet icon()}
					<Network class="h-4 w-4" />
				{/snippet}
			</EmptyState>
		{:else}
			<div class="max-h-48 overflow-y-auto pb-1" role="tree" aria-label="dbt models">
				{#each [...modelsBySchema.entries()] as [schema, models]}
					<div class="px-3 pt-1 pb-0.5">
						<span class="text-2xs font-medium text-muted-foreground/50">{schema}</span>
					</div>
					{#each models as model}
						{@const status = modelStatusIcon(model)}
						<TreeRow depth={1} leafSpacer={false} title={model.description ?? undefined}>
							{#snippet icon()}
								<status.icon class="h-3 w-3 shrink-0 {status.class}" />
							{/snippet}
							{#snippet label()}
								<span class="min-w-0 flex-1 truncate font-mono text-xs">{model.name}</span>
							{/snippet}
							{#snippet trailing()}
								{#if model.description}
									<BookOpen
										class="h-2.5 w-2.5 shrink-0 text-muted-foreground/50 group-hover/row:text-muted-foreground"
									/>
								{/if}
								<button
									class="invisible shrink-0 rounded px-1 text-2xs text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-foreground"
									title="Test model"
									onclick={() =>
										runCommand(() => dbtTest(projectFolder!, model.name), `Test ${model.name}`)}
									disabled={!!runningJobId}
								>
									<FlaskConical class="h-2.5 w-2.5" />
								</button>
								<button
									class="invisible shrink-0 rounded px-1 text-2xs text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-foreground"
									title="Run model"
									onclick={() =>
										runCommand(() => dbtRun(projectFolder!, model.name), `Run ${model.name}`)}
									disabled={!!runningJobId}
								>
									<Play class="h-2.5 w-2.5" />
								</button>
							{/snippet}
						</TreeRow>
					{/each}
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Schedules sub-section -->
	{#if projectFolder}
		<div class="border-t border-border">
			<div class="flex h-9 shrink-0 items-center border-b border-border px-2">
				<button
					class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
					onclick={() => (schedulesExpanded = !schedulesExpanded)}
				>
					{#if schedulesExpanded}
						<ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					{:else}
						<ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					{/if}
					<Clock class="h-3 w-3 shrink-0 text-muted-foreground/60" />
					<span class="text-2xs font-medium text-muted-foreground">Schedules</span>
					{#if runningScheduleId}
						<span class="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-chart-1"
						></span>
					{:else if schedules.length > 0}
						<span class="ml-1 text-2xs text-muted-foreground/50"
							>{schedules.filter((s) => s.enabled).length}/{schedules.length}</span
						>
					{/if}
				</button>
				<!-- Link to Inngest monitoring UI (Docker: localhost:8288) -->
				<a
					href="http://localhost:8288"
					target="_blank"
					rel="noopener"
					class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
					title="Open Inngest dashboard (run history & logs)"
				>
					<Network class="h-3.5 w-3.5" />
				</a>
				<button
					class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
					title="Add schedule"
					onclick={openAddModal}
				>
					<Plus class="h-3.5 w-3.5" />
				</button>
			</div>

			{#if schedulesExpanded}
				{#if schedules.length === 0}
					<EmptyState description="No schedules — add one with +">
						{#snippet icon()}
							<Clock class="h-4 w-4" />
						{/snippet}
					</EmptyState>
				{:else}
					<div class="pb-1" role="tree" aria-label="dbt schedules">
						{#each schedules as schedule}
							<TreeRow leafSpacer={false}>
								{#snippet icon()}
									<!-- Enable/disable dot -->
									<button
										class="h-2 w-2 shrink-0 rounded-full transition-colors {schedule.enabled
											? 'bg-chart-1'
											: 'bg-muted-foreground/30'}"
										title={schedule.enabled ? 'Disable' : 'Enable'}
										onclick={() => void handleToggleSchedule(schedule)}
										aria-label={schedule.enabled ? 'Disable schedule' : 'Enable schedule'}
									></button>
								{/snippet}
								{#snippet label()}
									<span class="min-w-0 flex-1 truncate font-mono text-xs">{schedule.label}</span>
								{/snippet}
								{#snippet trailing()}
									{#if schedule.select}
										<span
											class="shrink-0 rounded-sm border border-border px-1 font-mono text-3xs text-muted-foreground/50"
											>{schedule.select}</span
										>
									{/if}

									<!-- Status badge -->
									{#if runningScheduleId === schedule.id}
										<Loader2 class="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
									{:else if schedule.lastRunStatus === 'pass'}
										<CheckCircle2 class="h-3 w-3 shrink-0 text-success" />
									{:else if schedule.lastRunStatus === 'error'}
										<XCircle class="h-3 w-3 shrink-0 text-destructive" />
									{:else}
										<Minus class="h-3 w-3 shrink-0 text-muted-foreground/40" />
									{/if}

									<!-- Hover actions -->
									<button
										class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-foreground"
										title="Edit"
										onclick={() => openEditModal(schedule)}
									>
										<Pencil class="h-3 w-3" />
									</button>
									<button
										class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-destructive"
										title="Delete"
										onclick={() => void handleDeleteSchedule(schedule.id)}
									>
										<Trash2 class="h-3 w-3" />
									</button>
								{/snippet}
							</TreeRow>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Live log drawer — floats above the sidebar, does not push layout -->
	{#if logOpen && logLines.length > 0}
		<div
			class="fixed bottom-0 left-0 z-(--z-overlay) w-72 rounded-tr-lg border border-border bg-background shadow-xl"
		>
			<div class="flex items-center justify-between border-b border-border px-2 py-1">
				<span class="truncate text-2xs font-medium text-muted-foreground">
					{runningJobId
						? `${logHeader}…`
						: exitCode === 0
							? `${logHeader} completed`
							: `${logHeader} failed (exit ${exitCode})`}
				</span>
				<button
					class="ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
					onclick={() => (logOpen = false)}
				>
					<X class="h-3 w-3" />
				</button>
			</div>
			<div class="max-h-44 overflow-y-auto px-2 py-1.5 font-mono text-2xs leading-5">
				{#each logLines as line}
					<div class={logLineClass(line)}>{line}</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- Schedule add/edit modal -->
{#if modalOpen && editingSchedule !== null}
	<DbtScheduleModal
		initial={editingSchedule}
		onSave={handleSaveSchedule}
		onClose={() => {
			modalOpen = false;
			editingSchedule = null;
		}}
	/>
{/if}
