<script lang="ts">
	import { CheckCircle, Circle, XCircle, Loader } from '@lucide/svelte';
	import type { SprintTask } from '$lib/types/ai-chat.js';

	interface Props {
		tasks: SprintTask[];
	}

	let { tasks }: Props = $props();

	let collapsed = $state(false);

	let allDone = $derived(tasks.length > 0 && tasks.every((t) => t.status === 'done' || t.status === 'skipped'));
</script>

<div class="border-b border-border/40 bg-muted/20" data-testid="sprint-board">
	<!-- Header -->
	<button
		class="flex w-full items-center justify-between px-3 py-1.5 text-left"
		onclick={() => (collapsed = !collapsed)}
	>
		<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
			Sprint · {tasks.filter((t) => t.status === 'done').length}/{tasks.length}
		</span>
		<span class="text-[10px] text-muted-foreground/60">{collapsed ? '▸' : '▾'}</span>
	</button>

	<!-- Task list -->
	{#if !collapsed}
		<ul class="pb-2">
			{#each tasks as task (task.id)}
				<li class="flex items-start gap-2 px-3 py-0.5">
					<!-- Status icon -->
					<span class="mt-0.5 shrink-0">
						{#if task.status === 'done'}
							<CheckCircle size={13} class="text-green-500" />
						{:else if task.status === 'active'}
							<Loader size={13} class="animate-spin text-primary" />
						{:else if task.status === 'failed'}
							<XCircle size={13} class="text-destructive" />
						{:else}
							<Circle size={13} class="text-muted-foreground/40" />
						{/if}
					</span>

					<!-- Title + result -->
					<div class="min-w-0 flex-1">
						<span
							class="block truncate text-[12px] leading-relaxed
								{task.status === 'done' ? 'text-foreground/60 line-through' :
								 task.status === 'active' ? 'text-foreground font-medium' :
								 task.status === 'failed' ? 'text-destructive' :
								 'text-muted-foreground'}"
						>
							{task.title}
						</span>
						{#if task.result && task.status === 'done'}
							<span class="block truncate text-[10px] text-muted-foreground/50">{task.result}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
