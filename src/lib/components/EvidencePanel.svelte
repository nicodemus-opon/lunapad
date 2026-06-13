<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		Play,
		Square,
		RefreshCw,
		ExternalLink,
		ChevronDown,
		ChevronRight,
		FileText,
		Plus,
		Loader2,
		X,
		Circle
	} from '@lucide/svelte';
	import {
		getProjectFolder,
		getIsEvidenceProject,
		getEvidenceDevPort,
		getEvidencePages,
		getEvidenceRunningJobId,
		startEvidenceServer,
		stopEvidenceServer,
		setEvidenceDevPort,
		refreshEvidencePages,
		openEvidencePreviewTab
	} from '$lib/stores/notebook.svelte';

	const projectFolder = $derived(getProjectFolder());
	const isEvidence = $derived(getIsEvidenceProject());
	const devPort = $derived(getEvidenceDevPort());
	const pages = $derived(getEvidencePages());
	const runningJobId = $derived(getEvidenceRunningJobId());

	let expanded = $state(true);
	let logLines = $state<string[]>([]);
	let logHeader = $state('');
	let logOpen = $state(false);
	let exitCode = $state<number | null>(null);
	let starting = $state(false);
	let stopping = $state(false);
	let newPageName = $state('');
	let showNewPage = $state(false);
	let logUnsubscribe: (() => void) | null = null;

	function logLineClass(line: string): string {
		if (/error|failed/i.test(line)) return 'text-destructive';
		if (/warn/i.test(line)) return 'text-yellow-500';
		if (/ready|localhost|✓|compiled/i.test(line)) return 'text-success';
		return 'text-muted-foreground';
	}

	function watchLogs(jobId: string): () => void {
		const ctrl = new AbortController();
		(async () => {
			try {
				const res = await fetch(`/api/evidence/logs?jobId=${encodeURIComponent(jobId)}`, {
					signal: ctrl.signal
				});
				if (!res.body) return;
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const parts = buffer.split('\n\n');
					buffer = parts.pop() ?? '';
					for (const part of parts) {
						const line = part.trim();
						if (!line.startsWith('data:')) continue;
						try {
							const event = JSON.parse(line.slice(5).trim()) as {
								type: string;
								text?: string;
								port?: number;
								exitCode?: number;
							};
							if (event.type === 'line' && event.text) {
								logLines = [...logLines, event.text];
							}
							if (event.type === 'port' && event.port) {
								setEvidenceDevPort(event.port);
							}
							if (event.type === 'done') {
								exitCode = event.exitCode ?? 0;
								starting = false;
							}
						} catch {
							/* ignore */
						}
					}
				}
			} catch {
				/* aborted */
			}
		})();
		return () => ctrl.abort();
	}

	async function handleStart() {
		if (!projectFolder || starting) return;
		starting = true;
		logLines = [];
		logHeader = 'Evidence dev server';
		exitCode = null;
		logOpen = true;
		logUnsubscribe?.();

		const jobId = await startEvidenceServer();
		if (!jobId) {
			starting = false;
			toast.error('Failed to start Evidence dev server');
			return;
		}
		logUnsubscribe = watchLogs(jobId);
		toast.success('Evidence dev server starting…');
	}

	async function handleStop() {
		if (stopping) return;
		stopping = true;
		logUnsubscribe?.();
		logUnsubscribe = null;
		await stopEvidenceServer();
		stopping = false;
		toast.info('Evidence dev server stopped');
	}

	async function handleNewPage() {
		if (!projectFolder || !newPageName.trim()) return;
		const slug = newPageName
			.trim()
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9-]/g, '');
		const pagePath = `pages/${slug}.md`;
		const content = `---\ntitle: ${newPageName.trim()}\n---\n\n# ${newPageName.trim()}\n\n`;
		try {
			await fetch('/api/evidence/page', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ folder: projectFolder, path: pagePath, content })
			});
			await refreshEvidencePages();
			openEvidencePreviewTab(pagePath);
			newPageName = '';
			showNewPage = false;
			toast.success(`Page "${slug}.md" created`);
		} catch {
			toast.error('Failed to create page');
		}
	}

	const serverUrl = $derived(devPort ? `http://localhost:${devPort}` : null);
</script>

{#if isEvidence}
	<div class="flex flex-col text-sm">
		<!-- Header -->
		<button
			class="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/40"
			onclick={() => (expanded = !expanded)}
		>
			{#if expanded}
				<ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			{:else}
				<ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			{/if}
			<span class="flex-1 text-left text-xs font-semibold tracking-wide text-foreground uppercase"
				>Evidence</span
			>
			{#if runningJobId}
				<span class="flex shrink-0 items-center gap-1 text-2xs text-success">
					<Circle class="h-2 w-2 fill-green-500" />
					Port {devPort ?? '…'}
				</span>
			{/if}
		</button>

		{#if expanded}
			<!-- Server controls -->
			<div class="flex flex-wrap items-center gap-2 px-3 pb-2">
				{#if !runningJobId}
					<button
						class="flex h-7 items-center gap-1.5 rounded border border-border bg-background px-3 text-xs text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
						onclick={handleStart}
						disabled={starting}
					>
						{#if starting}
							<Loader2 class="h-3 w-3 animate-spin" />
						{:else}
							<Play class="h-3 w-3" />
						{/if}
						{starting ? 'Starting…' : 'Start dev server'}
					</button>
				{:else}
					<button
						class="flex h-7 items-center gap-1.5 rounded border border-border bg-background px-3 text-xs text-foreground transition-colors hover:bg-muted/50"
						onclick={handleStop}
						disabled={stopping}
					>
						<Square class="h-3 w-3" />
						Stop
					</button>
					{#if serverUrl}
						<a
							href={serverUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-1 text-xs text-primary hover:underline"
						>
							<ExternalLink class="h-3 w-3" />
							Open
						</a>
					{/if}
				{/if}
				<button
					class="ml-auto flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
					onclick={() => void refreshEvidencePages()}
					title="Refresh pages"
				>
					<RefreshCw class="h-3 w-3" />
				</button>
			</div>

			<!-- Log button -->
			{#if logLines.length > 0}
				<button
					class="mx-3 mb-2 flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
					onclick={() => (logOpen = !logOpen)}
				>
					<ChevronRight class="h-3 w-3 {logOpen ? 'rotate-90' : ''} transition-transform" />
					Dev server log
					{#if exitCode !== null}
						<span class="ml-auto {exitCode === 0 ? 'text-success' : 'text-destructive'}">
							exit {exitCode}
						</span>
					{/if}
				</button>
				{#if logOpen}
					<div
						class="mx-3 mb-2 max-h-40 overflow-y-auto rounded bg-black/20 p-2 font-mono text-2xs leading-relaxed"
					>
						{#each logLines as line (line)}
							<div class={logLineClass(line)}>{line}</div>
						{/each}
					</div>
				{/if}
			{/if}

			<!-- Pages list -->
			<div class="flex items-center justify-between px-3 pb-1">
				<span class="text-2xs font-medium tracking-wide text-muted-foreground uppercase">Pages</span
				>
				<button
					class="text-muted-foreground transition-colors hover:text-foreground"
					onclick={() => (showNewPage = !showNewPage)}
					title="New page"
				>
					<Plus class="h-3.5 w-3.5" />
				</button>
			</div>

			{#if showNewPage}
				<form
					class="flex gap-1 px-3 pb-2"
					onsubmit={(e) => {
						e.preventDefault();
						void handleNewPage();
					}}
				>
					<input
						class="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-primary/50 focus:outline-none"
						placeholder="page-name"
						bind:value={newPageName}
					/>
					<button
						type="submit"
						class="h-7 rounded border border-border px-2 text-xs hover:bg-muted/50"
					>
						Add
					</button>
					<button
						type="button"
						class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
						onclick={() => (showNewPage = false)}
					>
						<X class="h-3 w-3" />
					</button>
				</form>
			{/if}

			{#if pages.length === 0}
				<p class="px-3 pb-3 text-2xs text-muted-foreground">No pages found in pages/</p>
			{:else}
				<div class="pb-2">
					{#each pages as pagePath (pagePath)}
						{@const label = pagePath.replace(/^pages\//, '').replace(/\.md$/, '')}
						<div
							class="group flex items-center gap-1 px-3 py-1 transition-colors hover:bg-muted/40"
						>
							<FileText class="h-3 w-3 shrink-0 text-muted-foreground" />
							<span class="min-w-0 flex-1 truncate text-xs text-foreground" title={pagePath}
								>{label}</span
							>
							<div
								class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
							>
								{#if serverUrl}
									<button
										class="h-5 rounded px-1.5 text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										onclick={() => openEvidencePreviewTab(pagePath)}
										title="Preview">Preview</button
									>
									<a
										href="{serverUrl}/{label}"
										target="_blank"
										rel="noopener noreferrer"
										class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										title="Open in browser"><ExternalLink class="h-3 w-3" /></a
									>
								{:else}
									<button
										class="h-5 rounded px-1.5 text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										onclick={() => openEvidencePreviewTab(pagePath)}
										title="Start dev server to preview">Preview</button
									>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}
