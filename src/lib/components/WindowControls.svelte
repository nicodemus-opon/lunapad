<script lang="ts">
	async function minimize() {
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		await getCurrentWindow().minimize();
	}

	async function toggleMaximize() {
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		await getCurrentWindow().toggleMaximize();
	}

	async function close() {
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		await getCurrentWindow().close();
	}
</script>

<div class="flex h-full items-center" style="padding-right: var(--titlebar-inset-right)">
	<button
		onclick={minimize}
		class="flex h-8 w-11 items-center justify-center text-foreground/60 hover:bg-muted hover:text-foreground"
		aria-label="Minimize"
	>
		<svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
			<rect width="10" height="1" />
		</svg>
	</button>
	<button
		onclick={toggleMaximize}
		class="flex h-8 w-11 items-center justify-center text-foreground/60 hover:bg-muted hover:text-foreground"
		aria-label="Maximize"
	>
		<svg
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			stroke="currentColor"
			stroke-width="1"
		>
			<rect x="0.5" y="0.5" width="9" height="9" />
		</svg>
	</button>
	<button
		onclick={close}
		class="flex h-8 w-11 items-center justify-center text-foreground/60 hover:bg-destructive hover:text-white"
		aria-label="Close"
	>
		<svg
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			stroke="currentColor"
			stroke-width="1.2"
			stroke-linecap="round"
		>
			<line x1="1" y1="1" x2="9" y2="9" />
			<line x1="9" y1="1" x2="1" y2="9" />
		</svg>
	</button>
</div>
