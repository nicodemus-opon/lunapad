<script lang="ts">
	import { CheckCircle2, Circle, XCircle, Loader2 } from '@lucide/svelte';
	import type { SprintTask } from '$lib/types/ai-chat.js';
	import { SPRINT_TASK_STYLE } from './sprint-task-style.js';
	import { getCurrentActivityLabel } from '$lib/stores/ai-chat.svelte.js';

	interface Props {
		tasks: SprintTask[];
		/** When true, render only the task list (no outer header bar). */
		embedded?: boolean;
	}

	let { tasks, embedded = false }: Props = $props();

	let collapsed = $state(false);
	let activityLabel = $derived(getCurrentActivityLabel());
</script>

<div class={embedded ? '' : 'border-b border-border bg-muted/20'} data-testid="sprint-board">
	{#if !embedded}
		<button
			class="flex w-full items-center justify-between px-3 py-1.5 text-left"
			onclick={() => (collapsed = !collapsed)}
		>
			<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				Sprint · {tasks.filter((t) => t.status === 'done').length}/{tasks.length}
			</span>
			<span class="text-xs text-muted-foreground/60">{collapsed ? '▸' : '▾'}</span>
		</button>
	{/if}

	{#if embedded || !collapsed}
		<ul class={embedded ? 'py-1' : 'pb-2'}>
			{#each tasks as task (task.id)}
				{@const style = SPRINT_TASK_STYLE[task.type]}
				{@const TypeIcon = style.icon}
				<li
					class="flex items-start gap-2 border-l-2 px-2.5 py-0.5"
					style="border-color: {task.status === 'pending'
						? 'transparent'
						: `var(${style.colorVar})`}"
				>
					<span class="mt-0.5 shrink-0" style="color: var({style.colorVar})" title={style.label}>
						<TypeIcon size={11} />
					</span>

					<span class="mt-0.5 shrink-0">
						{#if task.status === 'done'}
							<CheckCircle2 size={13} class="text-success" />
						{:else if task.status === 'active'}
							<Loader2 size={13} class="animate-spin text-primary" />
						{:else if task.status === 'failed'}
							<XCircle size={13} class="text-destructive" />
						{:else}
							<Circle size={13} class="text-muted-foreground/40" />
						{/if}
					</span>

					<div class="min-w-0 flex-1">
						<span
							class="block truncate text-xs leading-relaxed
								{task.status === 'done'
								? 'text-foreground/60 line-through'
								: task.status === 'active'
									? 'font-medium text-foreground'
									: task.status === 'failed'
										? 'text-destructive'
										: 'text-muted-foreground'}"
						>
							{task.title}
						</span>
						{#if task.status === 'active' && activityLabel}
							<span class="block truncate text-xs text-primary/70">{activityLabel}</span>
						{:else if task.result && (task.status === 'done' || task.status === 'failed')}
							<span
								class="block truncate text-xs {task.status === 'failed'
									? 'text-destructive/70'
									: 'text-muted-foreground/50'}">{task.result}</span
							>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
