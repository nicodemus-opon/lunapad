<script lang="ts">
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import EmptyState from '$lib/components/sidebar/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import {
		createDashboard,
		deleteDashboard,
		getActiveTabId,
		getDashboards,
		getOpenExtraTabs,
		openDashboardTab,
		renameDashboard
	} from '$lib/stores/notebook.svelte';
	import type { Dashboard } from '$lib/types/gui-pipeline';
	import { LayoutDashboard, MoreHorizontal, Pencil, Plus, Trash2 } from '@lucide/svelte';

	type MenuAction =
		| { separator: true }
		| {
				separator?: undefined;
				label: string;
				icon: typeof Plus;
				onSelect: () => void;
				destructive?: boolean;
		  };

	const dashboards = $derived(getDashboards());
	const activeTabId = $derived(getActiveTabId());
	const openExtraTabs = $derived(getOpenExtraTabs());

	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let openMenuId = $state<string | null>(null);
	let confirmOpen = $state(false);
	let confirmTarget = $state<{ id: string; name: string } | null>(null);

	function dashboardTab(dashboardId: string) {
		return openExtraTabs.find((t) => t.type === 'dashboard' && t.dashboardId === dashboardId);
	}

	function startRename(dash: Dashboard) {
		renamingId = dash.id;
		renameValue = dash.name;
	}

	function commitRename() {
		const next = renameValue.trim();
		if (renamingId && next) {
			renameDashboard(renamingId, next);
		}
		renamingId = null;
		renameValue = '';
	}

	function onRenameKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Enter') commitRename();
		if (event.key === 'Escape') {
			renamingId = null;
			renameValue = '';
		}
	}

	function dashboardActions(dash: Dashboard): MenuAction[] {
		return [
			{ label: 'Open dashboard', icon: LayoutDashboard, onSelect: () => openDashboardTab(dash.id) },
			{ separator: true },
			{ label: 'Rename dashboard', icon: Pencil, onSelect: () => startRename(dash) },
			{
				label: 'Delete dashboard',
				icon: Trash2,
				destructive: true,
				onSelect: () => {
					confirmTarget = { id: dash.id, name: dash.name };
					confirmOpen = true;
				}
			}
		];
	}
</script>

{#snippet contextItems(actions: MenuAction[])}
	{#each actions as action, i (i)}
		{#if action.separator}
			<ContextMenu.Separator />
		{:else}
			{@const Icon = action.icon}
			<ContextMenu.Item
				variant={action.destructive ? 'destructive' : 'default'}
				onclick={action.onSelect}
			>
				<Icon />
				{action.label}
			</ContextMenu.Item>
		{/if}
	{/each}
{/snippet}

{#snippet dropdownItems(actions: MenuAction[])}
	{#each actions as action, i (i)}
		{#if action.separator}
			<DropdownMenu.Separator />
		{:else}
			{@const Icon = action.icon}
			<DropdownMenu.Item
				variant={action.destructive ? 'destructive' : 'default'}
				onclick={action.onSelect}
			>
				<Icon />
				{action.label}
			</DropdownMenu.Item>
		{/if}
	{/each}
{/snippet}

<div class="flex h-full flex-col overflow-hidden">
	<div class="flex-1 overflow-y-auto py-1">
		{#if dashboards.length === 0}
			<EmptyState description="Dashboards arrange cell results into a page you can share.">
				{#snippet icon()}<LayoutDashboard class="h-4 w-4" />{/snippet}
				{#snippet actions()}
					<Button
						variant="ghost"
						size="sm"
						onclick={() => {
							const d = createDashboard('New Dashboard');
							openDashboardTab(d.id);
						}}
					>
						<Plus /> New dashboard
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			{#each dashboards as dash (dash.id)}
				{@const tab = dashboardTab(dash.id)}
				{@const isActive = tab !== undefined && activeTabId === tab.id}
				{@const isOpen = tab !== undefined}
				<ContextMenu.Root>
					<ContextMenu.Trigger>
						<TreeRow
							depth={0}
							leafSpacer={false}
							selected={isActive}
							onActivate={() => openDashboardTab(dash.id)}
						>
							{#snippet icon()}
								<LayoutDashboard
									class="h-3.5 w-3.5 shrink-0 {isActive
										? 'text-foreground'
										: 'text-muted-foreground'}"
								/>
							{/snippet}
							{#snippet label()}
								{#if renamingId === dash.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										autofocus
										class="h-5 min-w-0 flex-1 border-0 border-b border-primary bg-transparent px-0 text-xs text-foreground outline-none"
										bind:value={renameValue}
										onblur={commitRename}
										onkeydown={onRenameKeydown}
										onclick={(e) => e.stopPropagation()}
									/>
								{:else}
									<span
										class="min-w-0 flex-1 truncate text-xs {isActive
											? 'font-medium text-foreground'
											: 'text-foreground/80'}"
									>
										{dash.name}
									</span>
								{/if}
							{/snippet}
							{#snippet trailing()}
								{#if isOpen && !isActive}
									<span
										class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50 group-hover/row:hidden"
										title="Open in a tab"
									></span>
								{/if}
								<DropdownMenu.Root
									open={openMenuId === dash.id}
									onOpenChange={(v) => (openMenuId = v ? dash.id : null)}
								>
									<DropdownMenu.Trigger
										class="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none {isActive ||
										openMenuId === dash.id
											? 'opacity-100'
											: 'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100'}"
										onclick={(e: MouseEvent) => e.stopPropagation()}
										aria-label="More actions"
									>
										<MoreHorizontal class="h-3.5 w-3.5" />
									</DropdownMenu.Trigger>
									<DropdownMenu.Content class="w-48" side="right" align="start">
										{@render dropdownItems(dashboardActions(dash))}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							{/snippet}
						</TreeRow>
					</ContextMenu.Trigger>
					<ContextMenu.Content class="w-48">
						{@render contextItems(dashboardActions(dash))}
					</ContextMenu.Content>
				</ContextMenu.Root>
			{/each}
		{/if}
	</div>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title={`Delete dashboard "${confirmTarget?.name ?? ''}"?`}
	body="The dashboard and its layout will be removed. Cell results are not affected."
	confirmLabel="Delete dashboard"
	onConfirm={() => {
		if (confirmTarget) deleteDashboard(confirmTarget.id);
		confirmTarget = null;
	}}
/>
