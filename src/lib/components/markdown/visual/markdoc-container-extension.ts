import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { mount, unmount } from 'svelte';
import type { Cell } from '$lib/stores/notebook.svelte';
import { parseAttrsJson } from './widget-registry';
import ContainerChrome from './ContainerChrome.svelte';
import MermaidContainerView from './MermaidContainerView.svelte';
import { mermaidCodeFromContainerNode } from './mermaid-code';
import { reactiveProps } from './reactive-props.svelte';
import { markdownToPmDocument } from '$lib/services/markdoc-pm';

export interface MarkdocContainerExtensionContext {
	getCells: () => Cell[];
}

function syncTabsStrip(
	dom: HTMLElement,
	contentDOM: HTMLElement,
	activeIndex: number,
	onSelect: (index: number) => void
) {
	let strip = dom.querySelector('.md-tabs-strip') as HTMLElement | null;
	if (!strip) {
		strip = document.createElement('div');
		strip.className = 'md-tabs-strip';
		strip.setAttribute('role', 'tablist');
		dom.insertBefore(strip, contentDOM);
	}
	strip.replaceChildren();
	const tabNodes = [
		...contentDOM.querySelectorAll(
			':scope > .markdoc-container-node[data-tag="tab"], :scope > .markdoc-container-node.is-tab'
		)
	];
	tabNodes.forEach((tabEl, i) => {
		const attrs = parseAttrsJson(tabEl.getAttribute('data-attrs-json') ?? '{}');
		const label = String(attrs.label ?? `Tab ${i + 1}`);
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = `md-tab-btn${i === activeIndex ? ' active' : ''}`;
		btn.setAttribute('role', 'tab');
		btn.setAttribute('aria-selected', String(i === activeIndex));
		btn.textContent = label;
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onSelect(i);
		});
		strip!.appendChild(btn);
		tabEl.classList.toggle('md-tab-active', i === activeIndex);
	});
}

function applyContainerSemantics(
	dom: HTMLElement,
	contentDOM: HTMLElement,
	tagName: string,
	attrsJson: string,
	tabState?: { activeIndex: number; onTabSelect?: (i: number) => void }
) {
	const attrs = parseAttrsJson(attrsJson);
	dom.className = 'markdoc-container-node group/container';
	contentDOM.className = 'markdoc-container-content';
	contentDOM.style.cssText = '';
	dom.dataset.tag = tagName;
	dom.dataset.attrsJson = attrsJson;

	const semantic = [
		'is-grid',
		'is-columns',
		'is-column',
		'is-callout',
		'is-card',
		'is-tabs',
		'is-tab',
		'is-details',
		'is-wysiwyg',
		'md-grid',
		'md-columns',
		'md-column',
		'md-callout',
		'md-card',
		'md-tabs',
		'md-details',
		'is-open',
		'md-tab-active'
	];
	const removableSemantic =
		tagName === 'tab' ? semantic.filter((className) => className !== 'md-tab-active') : semantic;
	dom.classList.remove(...removableSemantic);
	contentDOM.classList.remove(...semantic.filter((c) => c.startsWith('md-')));
	for (const key of Object.keys(dom.dataset)) {
		if (key.startsWith('callout')) delete dom.dataset[key];
	}

	// Remove dynamic chrome from prior renders
	dom.querySelector('.md-tabs-strip')?.remove();
	dom.querySelector('.md-details-summary')?.remove();
	dom.querySelector('.md-card-title-editor')?.remove();

	if (tagName === 'grid') {
		const cols = Number(attrs.cols ?? 3);
		dom.classList.add('is-grid', 'is-wysiwyg');
		contentDOM.classList.add('md-grid');
		contentDOM.style.setProperty('--md-grid-cols', String(cols));
	} else if (tagName === 'columns') {
		dom.classList.add('is-columns', 'is-wysiwyg');
		contentDOM.classList.add('md-columns');
	} else if (tagName === 'column') {
		dom.classList.add('is-column', 'is-wysiwyg');
		contentDOM.classList.add('md-column');
		if (attrs.width) contentDOM.style.flexBasis = String(attrs.width);
	} else if (tagName === 'callout') {
		const type = String(attrs.type ?? 'info');
		dom.classList.add('is-callout', 'is-wysiwyg', `md-callout--${type}`);
		contentDOM.classList.add('md-callout');
	} else if (tagName === 'card') {
		dom.classList.add('is-card', 'is-wysiwyg');
		contentDOM.classList.add('md-card');
		if (attrs.title) {
			const titleEl = document.createElement('div');
			titleEl.className = 'md-card-title md-card-title-editor';
			titleEl.textContent = String(attrs.title);
			dom.insertBefore(titleEl, contentDOM);
		}
	} else if (tagName === 'tabs') {
		dom.classList.add('is-tabs', 'is-wysiwyg', 'md-tabs');
		contentDOM.classList.add('md-tabs-body');
		const active = tabState?.activeIndex ?? 0;
		syncTabsStrip(dom, contentDOM, active, (i) => tabState?.onTabSelect?.(i));
	} else if (tagName === 'tab') {
		dom.classList.add('is-tab', 'is-wysiwyg');
		contentDOM.classList.add('md-tab-panel-content');
	} else if (tagName === 'details') {
		const summary = String(attrs.summary ?? 'Details');
		const open = Boolean(attrs.open);
		dom.classList.add('is-details', 'is-wysiwyg', 'md-details');
		if (open) dom.classList.add('is-open');
		contentDOM.classList.add('md-details-body');
		const summaryBtn = document.createElement('button');
		summaryBtn.type = 'button';
		summaryBtn.className = 'md-details-summary';
		summaryBtn.setAttribute('aria-expanded', String(open));
		summaryBtn.textContent = summary;
		summaryBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			dom.classList.toggle('is-open');
			summaryBtn.setAttribute('aria-expanded', String(dom.classList.contains('is-open')));
		});
		dom.insertBefore(summaryBtn, contentDOM);
	} else if (tagName === 'mermaid') {
		dom.classList.add('is-mermaid', 'is-wysiwyg', 'md-mermaid');
	} else if (tagName === 'if' || tagName === 'each' || tagName === 'group') {
		dom.classList.add('is-logic', 'is-wysiwyg');
	}
}

export const MarkdocContainerExtension = Node.create({
	name: 'markdocContainer',
	group: 'block',
	content: 'block+',
	defining: true,
	isolating: true,

	addAttributes() {
		return {
			tagName: { default: 'callout' },
			attrsJson: { default: '{}' }
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-markdoc-container]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-markdoc-container': 'true' }), 0];
	},

	addNodeView() {
		const ctx = this.options.context as MarkdocContainerExtensionContext | undefined;
		return ({ node, editor, getPos }) => {
			const dom = document.createElement('div');
			const contentDOM = document.createElement('div');
			dom.appendChild(contentDOM);

			let component: ReturnType<typeof mount> | null = null;
			let chromeHost: HTMLDivElement | null = null;
			let tagName = String(node.attrs.tagName ?? 'callout');
			let attrsJson = String(node.attrs.attrsJson ?? '{}');
			let isSelected = false;
			let activeTabIndex = 0;
			let tabObserver: MutationObserver | null = null;
			let tabSyncQueued = false;
			let tabPollHandle = 0;
			let tabPollFrames = 0;
			let mermaidMode: 'visual' | 'source' = 'visual';
			let mermaidHost: HTMLDivElement | null = null;
			let mermaidComponent: ReturnType<typeof mount> | null = null;
			let lastMermaidCode: string | null = null;
			let pmNode: ProseMirrorNode = node;

			const currentMermaidCode = () =>
				mermaidCodeFromContainerNode(pmNode, attrsJson, ctx?.getCells() ?? []);

			// Toggle which surface is visible. Called both from the node-view lifecycle
			// and (crucially) from the MermaidContainerView toggle handler — so it must
			// NEVER unmount that component synchronously, or we'd tear down the very
			// component whose click handler is still on the stack (lifecycle_double_unmount,
			// which wedges the toggle so further clicks do nothing).
			const applyMermaidView = () => {
				if (tagName !== 'mermaid') {
					if (mermaidComponent) {
						unmount(mermaidComponent);
						mermaidComponent = null;
					}
					mermaidHost?.remove();
					mermaidHost = null;
					lastMermaidCode = null;
					contentDOM.style.display = '';
					dom.classList.remove('is-mermaid-visual', 'is-mermaid-source');
					return;
				}
				if (!mermaidHost) {
					mermaidHost = document.createElement('div');
					mermaidHost.className = 'mermaid-container-host markdown-surface';
					dom.insertBefore(mermaidHost, contentDOM);
				}
				const isVisual = mermaidMode === 'visual';
				contentDOM.style.display = isVisual ? 'none' : '';
				dom.classList.toggle('is-mermaid-visual', isVisual);
				dom.classList.toggle('is-mermaid-source', !isVisual);
				renderMermaidChrome();
			};

			const handleMermaidModeChange = (mode: 'visual' | 'source') => {
				mermaidMode = mode;
				const isVisual = mode === 'visual';
				// The MermaidContainerView owns its own `mode` state and re-renders its
				// bar + diagram itself; here we only flip which surface (diagram vs. the
				// editable code contentDOM) is shown. No remount — see applyMermaidView.
				contentDOM.style.display = isVisual ? 'none' : '';
				dom.classList.toggle('is-mermaid-visual', isVisual);
				dom.classList.toggle('is-mermaid-source', !isVisual);
				if (!isVisual) {
					const pos = getPos();
					if (typeof pos === 'number') {
						editor.chain().focus().setNodeSelection(pos).run();
						requestAnimationFrame(() => {
							const codeEl = contentDOM.querySelector('pre, code, .cm-content');
							if (codeEl instanceof HTMLElement) codeEl.focus();
						});
					}
				}
			};

			// Mount once; thereafter only remount when the diagram *code* actually
			// changes (edits come from typing in contentDOM, never from the toggle),
			// so we never unmount during the toggle's own event handler.
			const renderMermaidChrome = () => {
				if (tagName !== 'mermaid' || !mermaidHost) return;
				const code = currentMermaidCode();
				if (mermaidComponent && code === lastMermaidCode) return;
				lastMermaidCode = code;
				if (mermaidComponent) {
					unmount(mermaidComponent);
					mermaidComponent = null;
				}
				mermaidComponent = mount(MermaidContainerView, {
					target: mermaidHost,
					props: {
						code,
						mode: mermaidMode,
						onModeChange: handleMermaidModeChange
					}
				});
			};

			const patchAttrs = (patch: Record<string, unknown>) => {
				const pos = getPos();
				if (typeof pos !== 'number') return;
				const next = { ...parseAttrsJson(attrsJson), ...patch };
				attrsJson = JSON.stringify(next);
				editor
					.chain()
					.focus()
					.command(({ tr }) => {
						tr.setNodeAttribute(pos, 'attrsJson', attrsJson);
						return true;
					})
					.run();
				applyContainerSemantics(dom, contentDOM, tagName, attrsJson, {
					activeIndex: activeTabIndex,
					onTabSelect: (i) => {
						activeTabIndex = i;
						applyContainerSemantics(dom, contentDOM, tagName, attrsJson, {
							activeIndex: activeTabIndex,
							onTabSelect: (idx) => {
								activeTabIndex = idx;
								applyContainerSemantics(dom, contentDOM, tagName, attrsJson, {
									activeIndex: activeTabIndex,
									onTabSelect: () => {}
								});
							}
						});
					}
				});
				renderChrome();
			};

			const addChild = () => {
				const pos = getPos();
				if (typeof pos !== 'number') return;
				const containerNode = editor.state.doc.nodeAt(pos);
				if (!containerNode) return;
				let snippet: string | null = null;
				if (tagName === 'columns') {
					snippet = '{% column %}\n\n{% /column %}';
				} else if (tagName === 'tabs') {
					const tabCount = containerNode.content.childCount + 1;
					snippet = `{% tab label="Tab ${tabCount}" %}\n\n{% /tab %}`;
				}
				if (!snippet) return;
				const child = markdownToPmDocument(snippet).doc.content?.[0];
				if (!child) return;
				const insertPos = pos + 1 + containerNode.content.size;
				editor.chain().focus().insertContentAt(insertPos, child).run();
				if (tagName === 'tabs') {
					activeTabIndex = containerNode.content.childCount;
					requestAnimationFrame(() => applyAll());
				}
			};

			// Chrome is mounted lazily but only ONCE; afterwards its reactive props are
			// mutated in place and visibility is toggled via CSS. Remounting on every
			// select/update destroyed any open dropdown inside the chrome mid-click.
			const chromeProps = reactiveProps({
				tagName,
				attrs: parseAttrsJson(attrsJson),
				selected: false,
				onSelect: () => {
					const pos = getPos();
					if (typeof pos === 'number') {
						editor.chain().focus().setNodeSelection(pos).run();
					}
				},
				onDelete: () => {
					editor.chain().focus().deleteSelection().run();
				},
				onPatchAttrs: (patch: Record<string, unknown>) => patchAttrs(patch),
				onAddChild: () => addChild()
			});

			const renderChrome = () => {
				const minimalChrome =
					tagName === 'tabs' ||
					tagName === 'grid' ||
					tagName === 'columns' ||
					tagName === 'callout' ||
					tagName === 'card' ||
					tagName === 'column' ||
					tagName === 'tab' ||
					tagName === 'details' ||
					tagName === 'mermaid';
				const showChrome = !minimalChrome || isSelected;

				chromeProps.tagName = tagName;
				chromeProps.attrs = parseAttrsJson(attrsJson);
				chromeProps.selected = isSelected;

				if (showChrome && !chromeHost) {
					chromeHost = document.createElement('div');
					chromeHost.className = 'markdoc-container-chrome';
					dom.insertBefore(chromeHost, contentDOM);
					component = mount(ContainerChrome, { target: chromeHost, props: chromeProps });
				}
				if (chromeHost) chromeHost.style.display = showChrome ? '' : 'none';
			};

			const applyAll = () => {
				applyContainerSemantics(dom, contentDOM, tagName, attrsJson, {
					activeIndex: activeTabIndex,
					onTabSelect: (i) => {
						activeTabIndex = i;
						applyContainerSemantics(dom, contentDOM, tagName, attrsJson, {
							activeIndex: activeTabIndex,
							onTabSelect: (idx) => {
								activeTabIndex = idx;
								applyAll();
							}
						});
					}
				});
				if (tagName === 'tabs') {
					requestAnimationFrame(() => {
						applyContainerSemantics(dom, contentDOM, tagName, attrsJson, {
							activeIndex: activeTabIndex,
							onTabSelect: (i) => {
								activeTabIndex = i;
								applyAll();
							}
						});
					});
				}
			};

			// Rebuild the tab strip if it is out of sync with the actual tab nodes.
			// Returns true once at least one tab node exists (strip is now populated).
			const trySyncTabs = () => {
				if (tagName !== 'tabs') return true;
				const tabCount = contentDOM.querySelectorAll(
					':scope > .markdoc-container-node[data-tag="tab"], :scope > .markdoc-container-node.is-tab'
				).length;
				if (tabCount === 0) return false;
				const stripCount = dom.querySelector(':scope > .md-tabs-strip')?.children.length ?? 0;
				if (stripCount === tabCount) return true;
				applyContainerSemantics(dom, contentDOM, tagName, attrsJson, {
					activeIndex: activeTabIndex,
					onTabSelect: (i) => {
						activeTabIndex = i;
						applyAll();
					}
				});
				return true;
			};

			// Child tab node views are attributed across several frames on first
			// render, so poll for a short window until the strip is populated.
			const pollTabs = () => {
				tabPollFrames += 1;
				const ready = trySyncTabs();
				if (ready || tabPollFrames > 40) {
					tabPollHandle = 0;
					return;
				}
				tabPollHandle = requestAnimationFrame(pollTabs);
			};

			const startTabPoll = () => {
				if (tagName !== 'tabs') return;
				tabPollFrames = 0;
				if (tabPollHandle) cancelAnimationFrame(tabPollHandle);
				tabPollHandle = requestAnimationFrame(pollTabs);
			};

			const ensureTabObserver = () => {
				if (tagName !== 'tabs' || tabObserver) return;
				tabObserver = new MutationObserver(() => {
					if (tabSyncQueued) return;
					tabSyncQueued = true;
					requestAnimationFrame(() => {
						tabSyncQueued = false;
						trySyncTabs();
					});
				});
				tabObserver.observe(contentDOM, {
					attributes: true,
					attributeFilter: ['class', 'data-tag', 'data-attrs-json'],
					childList: true,
					subtree: true
				});
				startTabPoll();
			};

			applyAll();
			ensureTabObserver();
			applyMermaidView();
			renderChrome();

			return {
				dom,
				contentDOM,
				update(updatedNode) {
					if (updatedNode.type.name !== 'markdocContainer') return false;
					pmNode = updatedNode;
					tagName = String(updatedNode.attrs.tagName ?? tagName);
					attrsJson = String(updatedNode.attrs.attrsJson ?? attrsJson);
					applyAll();
					ensureTabObserver();
					startTabPoll();
					applyMermaidView();
					renderChrome();
					return true;
				},
				destroy() {
					if (component) unmount(component);
					if (mermaidComponent) unmount(mermaidComponent);
					tabObserver?.disconnect();
					if (tabPollHandle) cancelAnimationFrame(tabPollHandle);
				},
				selectNode() {
					isSelected = true;
					dom.classList.add('ProseMirror-selectednode');
					renderChrome();
				},
				deselectNode() {
					isSelected = false;
					dom.classList.remove('ProseMirror-selectednode');
					renderChrome();
				},
				stopEvent(event) {
					const target = event.target as HTMLElement;
					if (target.closest('.md-tabs-strip, .md-details-summary, .md-tab-btn')) return true;
					if (
						target.closest('.markdoc-container-chrome, .mermaid-container-host, .markdown-mode-bar')
					)
						return true;
					return false;
				},
				ignoreMutation(mutation) {
					// Let ProseMirror manage the selection and real content edits inside
					// contentDOM, but ignore everything we manage ourselves: injected
					// chrome (tab strip, details summary, card title, container chrome)
					// that lives outside contentDOM, and the class/attribute toggles we
					// apply for active-tab/semantics state. Without this, ProseMirror's
					// DOMObserver treats our DOM writes as external edits and re-renders,
					// which recreates the node view and re-triggers our writes — an
					// infinite render loop.
					if (mutation.type === 'selection') return false;
					if (mutation.type === 'attributes') return true;
					return !contentDOM.contains(mutation.target as globalThis.Node);
				}
			};
		};
	}
});

export function createMarkdocContainerExtension(context: MarkdocContainerExtensionContext) {
	return MarkdocContainerExtension.configure({ context });
}
