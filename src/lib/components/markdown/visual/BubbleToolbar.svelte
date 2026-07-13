<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import {
		Bold,
		Italic,
		Underline,
		Strikethrough,
		Code,
		Link,
		Highlighter,
		Heading2,
		ChevronDown
	} from '@lucide/svelte';
	import LinkPopover from './LinkPopover.svelte';

	interface Props {
		editor: Editor;
	}

	const { editor }: Props = $props();

	let turnIntoOpen = $state(false);
	let linkOpen = $state(false);
	let toolbarEl = $state<HTMLDivElement | null>(null);

	function openLinkPopover() {
		linkOpen = true;
		turnIntoOpen = false;
	}

	function applyLink(url: string) {
		if (!url) {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		} else {
			editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
		}
		linkOpen = false;
	}

	function closeDropdowns() {
		linkOpen = false;
		turnIntoOpen = false;
	}

	function onDocumentPointerDown(e: PointerEvent) {
		if (!toolbarEl?.contains(e.target as Node)) closeDropdowns();
	}

	onMount(() => {
		document.addEventListener('pointerdown', onDocumentPointerDown);
		return () => document.removeEventListener('pointerdown', onDocumentPointerDown);
	});

	const turnIntoOptions = [
		{ label: 'Paragraph', action: () => editor.chain().focus().setParagraph().run() },
		{ label: 'Heading 1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
		{ label: 'Heading 2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
		{ label: 'Heading 3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
		{ label: 'Bullet list', action: () => editor.chain().focus().toggleBulletList().run() },
		{ label: 'Numbered list', action: () => editor.chain().focus().toggleOrderedList().run() },
		{ label: 'Task list', action: () => editor.chain().focus().toggleTaskList().run() },
		{ label: 'Quote', action: () => editor.chain().focus().toggleBlockquote().run() },
		{ label: 'Code block', action: () => editor.chain().focus().toggleCodeBlock().run() }
	];
</script>

<div
	bind:this={toolbarEl}
	class="bubble-toolbar flex items-center gap-0.5 rounded-sm border bg-popover px-1 py-0.5 shadow-md"
>
	<button
		type="button"
		class="bubble-btn {editor.isActive('bold') ? 'is-active' : ''}"
		title="Bold"
		onmousedown={(e) => {
			e.preventDefault();
			editor.chain().focus().toggleBold().run();
		}}
	>
		<Bold class="h-3.5 w-3.5" />
	</button>
	<button
		type="button"
		class="bubble-btn {editor.isActive('italic') ? 'is-active' : ''}"
		title="Italic"
		onmousedown={(e) => {
			e.preventDefault();
			editor.chain().focus().toggleItalic().run();
		}}
	>
		<Italic class="h-3.5 w-3.5" />
	</button>
	<button
		type="button"
		class="bubble-btn {editor.isActive('underline') ? 'is-active' : ''}"
		title="Underline"
		onmousedown={(e) => {
			e.preventDefault();
			editor.chain().focus().toggleUnderline().run();
		}}
	>
		<Underline class="h-3.5 w-3.5" />
	</button>
	<button
		type="button"
		class="bubble-btn {editor.isActive('strike') ? 'is-active' : ''}"
		title="Strikethrough"
		onmousedown={(e) => {
			e.preventDefault();
			editor.chain().focus().toggleStrike().run();
		}}
	>
		<Strikethrough class="h-3.5 w-3.5" />
	</button>
	<button
		type="button"
		class="bubble-btn {editor.isActive('code') ? 'is-active' : ''}"
		title="Code"
		onmousedown={(e) => {
			e.preventDefault();
			editor.chain().focus().toggleCode().run();
		}}
	>
		<Code class="h-3.5 w-3.5" />
	</button>

	<div class="relative">
		<button
			type="button"
			class="bubble-btn {editor.isActive('link') || linkOpen ? 'is-active' : ''}"
			title="Link"
			onmousedown={(e) => {
				e.preventDefault();
				if (linkOpen) {
					linkOpen = false;
				} else {
					openLinkPopover();
				}
			}}
		>
			<Link class="h-3.5 w-3.5" />
		</button>
		{#if linkOpen}
			<div class="absolute top-full left-0 z-50 mt-1">
				<LinkPopover
					initialUrl={(editor.getAttributes('link').href as string | undefined) ?? 'https://'}
					onApply={applyLink}
					onCancel={() => (linkOpen = false)}
				/>
			</div>
		{/if}
	</div>

	<button
		type="button"
		class="bubble-btn {editor.isActive('highlight') ? 'is-active' : ''}"
		title="Highlight"
		onmousedown={(e) => {
			e.preventDefault();
			editor.chain().focus().toggleHighlight().run();
		}}
	>
		<Highlighter class="h-3.5 w-3.5" />
	</button>

	<span class="mx-0.5 h-4 w-px bg-border"></span>

	<div class="relative">
		<button
			type="button"
			class="bubble-btn flex items-center gap-0.5 pr-1"
			title="Turn into"
			onmousedown={(e) => {
				e.preventDefault();
				turnIntoOpen = !turnIntoOpen;
				if (turnIntoOpen) linkOpen = false;
			}}
		>
			<Heading2 class="h-3.5 w-3.5" />
			<ChevronDown class="h-3 w-3 opacity-60" />
		</button>
		{#if turnIntoOpen}
			<div
				class="absolute top-full left-0 z-50 mt-1 min-w-36 rounded-md border bg-popover p-1 shadow-lg"
				role="menu"
				tabindex="-1"
				onmousedown={(e) => e.stopPropagation()}
			>
				{#each turnIntoOptions as opt (opt.label)}
					<button
						type="button"
						class="flex w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						onmousedown={(e) => {
							e.preventDefault();
							opt.action();
							turnIntoOpen = false;
						}}
					>
						{opt.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.bubble-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.65rem;
		height: 1.65rem;
		border-radius: var(--radius-sm);
		color: var(--foreground);
		transition:
			background var(--motion-fast, 130ms) var(--motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
			color var(--motion-fast, 130ms) var(--motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}
	.bubble-btn:hover,
	.bubble-btn.is-active {
		background: color-mix(in oklab, var(--accent) 78%, transparent);
		color: var(--accent-foreground);
	}
	.bubble-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--ring) 50%, transparent);
	}
</style>
