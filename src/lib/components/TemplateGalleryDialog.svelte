<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { FilePlus } from '@lucide/svelte';
	import { TEMPLATE_CATEGORIES } from '$lib/demo/templates/registry';
	import { loadDashboardTemplate, addNotebook } from '$lib/stores/notebook.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	function pick(id: string) {
		loadDashboardTemplate(id);
		open = false;
	}

	function pickBlank() {
		addNotebook();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-3xl gap-0 overflow-hidden p-0">
		<Dialog.Header class="px-5 pt-5 pb-3">
			<Dialog.Title>Start from a template</Dialog.Title>
			<Dialog.Description class="leading-relaxed">
				Every template is a regular notebook — pick a starting point, then edit it freely.
			</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-[65vh] overflow-y-auto px-5 pb-5">
			<button
				type="button"
				class="mb-5 flex w-full items-center gap-3 rounded-lg border border-dashed border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
				onclick={pickBlank}
			>
				<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
					<FilePlus class="h-4 w-4 text-muted-foreground" />
				</div>
				<div class="min-w-0">
					<p class="text-sm font-medium text-foreground">Blank notebook</p>
					<p class="text-xs text-muted-foreground">Start from scratch with a single empty cell.</p>
				</div>
			</button>

			{#each TEMPLATE_CATEGORIES as group (group.id)}
				<div class="mb-5 last:mb-0">
					<h3 class="mb-2 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
						{group.label}
					</h3>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each group.templates as template (template.id)}
							{@const Icon = template.icon}
							<button
								type="button"
								class="flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
								onclick={() => pick(template.id)}
							>
								<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
									<Icon class="h-4 w-4 text-accent-foreground" />
								</div>
								<div class="min-w-0">
									<p class="text-sm font-medium text-foreground">{template.name}</p>
									<p class="text-xs text-muted-foreground">{template.description}</p>
								</div>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>
