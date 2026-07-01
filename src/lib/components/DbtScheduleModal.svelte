<script lang="ts">
	import { X } from '@lucide/svelte';
	import type { DbtSchedule } from '$lib/types/schedule';

	interface Props {
		initial?: Partial<DbtSchedule>;
		onSave: (schedule: DbtSchedule) => void;
		onClose: () => void;
	}

	const { initial = {}, onSave, onClose }: Props = $props();

	let label = $state(initial?.label ?? '');
	let cron = $state(initial?.cron ?? '0 8 * * *');
	let select = $state(initial?.select ?? '');
	let enabled = $state(initial?.enabled ?? true);

	let nextRuns = $state<string[]>([]);
	let cronError = $state('');
	let cronCheckTimer: ReturnType<typeof setTimeout> | null = null;

	function makeId(): string {
		return Math.random().toString(36).slice(2, 10);
	}

	async function fetchNextRuns(expr: string) {
		if (!expr.trim()) {
			nextRuns = [];
			cronError = '';
			return;
		}
		try {
			const res = await fetch('/api/schedules', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cron: expr, count: 3 })
			});
			const body = (await res.json()) as { nextRuns?: string[]; error?: string };
			if (!res.ok || body.error) {
				cronError = body.error ?? 'Invalid cron expression';
				nextRuns = [];
			} else {
				cronError = '';
				nextRuns = (body.nextRuns ?? []).map((iso) => {
					const d = new Date(iso);
					return d.toLocaleString(undefined, {
						weekday: 'short',
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit'
					});
				});
			}
		} catch {
			cronError = 'Could not validate cron';
			nextRuns = [];
		}
	}

	$effect(() => {
		if (cronCheckTimer) clearTimeout(cronCheckTimer);
		cronCheckTimer = setTimeout(() => void fetchNextRuns(cron), 400);
	});

	// Trigger once on mount
	$effect(() => {
		void fetchNextRuns(cron);
	});

	const isValid = $derived(label.trim().length > 0 && cron.trim().length > 0 && !cronError);

	function handleSave() {
		if (!isValid) return;
		onSave({
			id: initial.id ?? makeId(),
			label: label.trim(),
			cron: cron.trim(),
			select: select.trim(),
			enabled,
			createdAt: initial.createdAt ?? Date.now(),
			lastRunAt: initial.lastRunAt ?? null,
			lastRunStatus: initial.lastRunStatus ?? null,
			lastRunJobId: initial.lastRunJobId ?? null
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<div
	class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
	role="presentation"
	onclick={onClose}
></div>

<!-- Modal -->
<div
	class="fixed top-[28%] left-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl"
>
	<div class="flex items-center justify-between border-b border-border/60 px-5 py-4">
		<span class="text-[15px] font-semibold">{initial.id ? 'Edit schedule' : 'Add schedule'}</span>
		<button
			class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
			onclick={onClose}
		>
			<X class="h-4 w-4" />
		</button>
	</div>

	<div class="flex flex-col gap-4 px-5 py-4">
		<!-- Label -->
		<div class="flex flex-col gap-1.5">
			<label class="text-[12px] font-medium text-foreground/70" for="sched-label">Label</label>
			<input
				id="sched-label"
				class="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-[13px] focus:ring-2 focus:ring-primary/40 focus:outline-none"
				placeholder="e.g. daily_refresh"
				bind:value={label}
			/>
		</div>

		<!-- Cron expression -->
		<div class="flex flex-col gap-1.5">
			<label class="text-[12px] font-medium text-foreground/70" for="sched-cron"
				>Cron expression</label
			>
			<input
				id="sched-cron"
				class="w-full rounded-lg border bg-background px-3 py-2 font-mono text-[13px] focus:ring-2 focus:outline-none {cronError
					? 'border-destructive focus:ring-destructive/40'
					: 'border-input focus:ring-primary/40'}"
				placeholder="0 8 * * *"
				bind:value={cron}
			/>
			{#if cronError}
				<p class="text-[11px] text-destructive">{cronError}</p>
			{:else if nextRuns.length > 0}
				<p class="font-mono text-[11px] leading-relaxed text-muted-foreground/60">
					Next: {nextRuns.join(' · ')}
				</p>
			{/if}
		</div>

		<!-- Model filter -->
		<div class="flex flex-col gap-1.5">
			<label class="text-[12px] font-medium text-foreground/70" for="sched-select">
				Model filter <span class="font-normal text-muted-foreground/50">(optional)</span>
			</label>
			<input
				id="sched-select"
				class="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-[13px] focus:ring-2 focus:ring-primary/40 focus:outline-none"
				placeholder="e.g. marts/+ or tag:nightly"
				bind:value={select}
			/>
			<p class="text-[11px] text-muted-foreground/60">
				Passed to dbt as <span class="font-mono">--select</span>. Leave blank to run all models.
			</p>
		</div>

		<!-- Enabled toggle -->
		<div class="flex items-center justify-between">
			<span class="text-[12px] font-medium text-foreground/70">Enable on save</span>
			<button
				type="button"
				role="switch"
				aria-checked={enabled}
				class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-primary/40 focus:outline-none {enabled
					? 'bg-primary'
					: 'bg-muted-foreground/30'}"
				onclick={() => (enabled = !enabled)}
			>
				<span
					class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform {enabled
						? 'translate-x-4'
						: 'translate-x-0'}"
				></span>
			</button>
		</div>
	</div>

	<div class="flex justify-end gap-2 border-t border-border/60 px-5 py-4">
		<button
			class="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted"
			onclick={onClose}
		>
			Cancel
		</button>
		<button
			class="rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
			disabled={!isValid}
			onclick={handleSave}
		>
			{initial.id ? 'Save' : 'Create'}
		</button>
	</div>
</div>
