<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import type { DbtSchedule } from '$lib/types/schedule';

	interface Props {
		initial?: Partial<DbtSchedule>;
		onSave: (schedule: DbtSchedule) => void;
		onClose: () => void;
	}

	const { initial = {}, onSave, onClose }: Props = $props();

	let label = $state('');
	let cron = $state('0 8 * * *');
	let select = $state('');
	let enabled = $state(true);

	let nextRuns = $state<string[]>([]);
	let cronError = $state('');
	let cronCheckTimer: ReturnType<typeof setTimeout> | null = null;
	let loadedInitialKey = '';

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
		const key = initial.id ?? `new:${initial.createdAt ?? ''}:${initial.label ?? ''}`;
		if (key === loadedInitialKey) return;
		loadedInitialKey = key;
		label = initial.label ?? '';
		cron = initial.cron ?? '0 8 * * *';
		select = initial.select ?? '';
		enabled = initial.enabled ?? true;
	});

	$effect(() => {
		if (cronCheckTimer) clearTimeout(cronCheckTimer);
		cronCheckTimer = setTimeout(() => void fetchNextRuns(cron), 400);
		return () => {
			if (cronCheckTimer) clearTimeout(cronCheckTimer);
		};
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
</script>

<Dialog.Root open onOpenChange={(v) => !v && onClose()}>
	<Dialog.Content class="relative max-w-[420px] gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>{initial.id ? 'Edit schedule' : 'Add schedule'}</Dialog.Title>
		</Dialog.Header>
		<Dialog.Close class="absolute top-2.5 right-3" />

		<div class="flex flex-col gap-4 px-4 py-4">
			<!-- Label -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-medium text-foreground/70" for="sched-label">Label</label>
				<input
					id="sched-label"
					class="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none"
					placeholder="e.g. daily_refresh"
					bind:value={label}
				/>
			</div>

			<!-- Cron expression -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-medium text-foreground/70" for="sched-cron"
					>Cron expression</label
				>
				<input
					id="sched-cron"
					class="w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none {cronError
						? 'border-destructive focus:ring-destructive/40'
						: 'border-input focus:ring-primary/40'}"
					placeholder="0 8 * * *"
					bind:value={cron}
				/>
				{#if cronError}
					<p class="text-2xs text-destructive">{cronError}</p>
				{:else if nextRuns.length > 0}
					<p class="font-mono text-2xs leading-relaxed text-muted-foreground/60">
						Next: {nextRuns.join(' · ')}
					</p>
				{/if}
			</div>

			<!-- Model filter -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-medium text-foreground/70" for="sched-select">
					Model filter <span class="font-normal text-muted-foreground/50">(optional)</span>
				</label>
				<input
					id="sched-select"
					class="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none"
					placeholder="e.g. marts/+ or tag:nightly"
					bind:value={select}
				/>
				<p class="text-2xs text-muted-foreground/60">
					Passed to dbt as <span class="font-mono">--select</span>. Leave blank to run all models.
				</p>
			</div>

			<!-- Enabled toggle -->
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-foreground/70">Enable on save</span>
				<button
					type="button"
					role="switch"
					aria-checked={enabled}
					aria-label="Enable schedule on save"
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

		<Dialog.Footer>
			<Button variant="ghost" size="sm" class="h-7 text-xs" onclick={onClose}>Cancel</Button>
			<Button size="sm" class="h-7 text-xs" disabled={!isValid} onclick={handleSave}>
				{initial.id ? 'Save' : 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
