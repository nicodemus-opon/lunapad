import BaseTaskItem from '@tiptap/extension-task-item';
import { getRenderedAttributes, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { mount, unmount } from 'svelte';
import TaskItemCheckbox from './TaskItemCheckbox.svelte';

function checkboxLabel(node: ProseMirrorNode, checked: boolean, options: Record<string, any>) {
	return (
		options.a11y?.checkboxLabel?.(node, checked) ||
		`Task item checkbox for ${node.textContent || 'empty task item'}`
	);
}

function checkboxState(checked: boolean) {
	return checked ? 'checked' : 'unchecked';
}

export const LunapadTaskItem = BaseTaskItem.extend({
	renderHTML({ node, HTMLAttributes }) {
		const checked = Boolean(node.attrs.checked);
		return [
			'li',
			mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
				'data-type': this.name,
				'data-checked': checked
			}),
			[
				'div',
				{
					class: 'md-task-checkbox-slot',
					contenteditable: 'false'
				},
				[
					'button',
					{
						type: 'button',
						role: 'checkbox',
						disabled: 'disabled',
						'aria-checked': checked ? 'true' : 'false',
						'aria-label': checkboxLabel(node, checked, this.options),
						'data-slot': 'checkbox',
						'data-state': checkboxState(checked),
						class: 'md-task-checkbox'
					},
					['span', { class: 'md-task-checkbox-indicator' }]
				]
			],
			['div', { class: 'md-task-content' }, 0]
		];
	},

	addNodeView() {
		return ({ node, HTMLAttributes, getPos, editor }) => {
			const listItem = document.createElement('li');
			const checkboxHost = document.createElement('div');
			const content = document.createElement('div');
			let currentNode = node;
			let renderedAttributeKeys = new Set(Object.keys(HTMLAttributes));
			let component: ReturnType<typeof mount> | null = null;

			checkboxHost.className = 'md-task-checkbox-slot';
			checkboxHost.contentEditable = 'false';
			content.className = 'md-task-content';

			const commitChecked = (checked: boolean) => {
				if (!editor.isEditable && !this.options.onReadOnlyChecked) return;

				if (editor.isEditable && typeof getPos === 'function') {
					editor
						.chain()
						.focus(undefined, { scrollIntoView: false })
						.command(({ tr }) => {
							const position = getPos();
							if (typeof position !== 'number') return false;
							const taskNode = tr.doc.nodeAt(position);

							tr.setNodeMarkup(position, undefined, {
								...taskNode?.attrs,
								checked
							});

							return true;
						})
						.run();
				}

				if (!editor.isEditable && this.options.onReadOnlyChecked) {
					this.options.onReadOnlyChecked(currentNode, checked);
				}
			};

			const renderCheckbox = () => {
				if (component) unmount(component);
				component = mount(TaskItemCheckbox, {
					target: checkboxHost,
					props: {
						checked: Boolean(currentNode.attrs.checked),
						ariaLabel: checkboxLabel(currentNode, Boolean(currentNode.attrs.checked), this.options),
						disabled: !editor.isEditable && !this.options.onReadOnlyChecked,
						onCheckedChange: commitChecked
					}
				});
			};

			Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
				listItem.setAttribute(key, String(value));
			});

			Object.entries(HTMLAttributes).forEach(([key, value]) => {
				if (value != null) listItem.setAttribute(key, String(value));
			});

			listItem.dataset.checked = String(Boolean(node.attrs.checked));
			listItem.dataset.type = this.name;
			listItem.append(checkboxHost, content);
			renderCheckbox();

			return {
				dom: listItem,
				contentDOM: content,
				update: (updatedNode) => {
					if (updatedNode.type !== this.type) return false;

					currentNode = updatedNode;
					listItem.dataset.checked = String(Boolean(updatedNode.attrs.checked));

					const extensionAttributes = editor.extensionManager.attributes;
					const nextAttributes = getRenderedAttributes(updatedNode, extensionAttributes);
					const nextKeys = new Set(Object.keys(nextAttributes));
					const staticAttributes = this.options.HTMLAttributes;

					renderedAttributeKeys.forEach((key) => {
						if (nextKeys.has(key)) return;
						if (key in staticAttributes) {
							listItem.setAttribute(key, String(staticAttributes[key]));
						} else {
							listItem.removeAttribute(key);
						}
					});

					Object.entries(nextAttributes).forEach(([key, value]) => {
						if (value == null) {
							if (key in staticAttributes) {
								listItem.setAttribute(key, String(staticAttributes[key]));
							} else {
								listItem.removeAttribute(key);
							}
						} else {
							listItem.setAttribute(key, String(value));
						}
					});

					renderedAttributeKeys = nextKeys;
					renderCheckbox();

					return true;
				},
				destroy: () => {
					if (component) unmount(component);
				}
			};
		};
	}
});
