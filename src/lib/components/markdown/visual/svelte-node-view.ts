import { mount, unmount, type Component } from 'svelte';

export interface SvelteNodeViewHandle {
	dom: HTMLElement;
	updateProps(props: Record<string, unknown>): void;
	destroy(): void;
	select(): void;
	deselect(): void;
}

/** Mount a Svelte component into a ProseMirror node view DOM shell. */
export function createSvelteNodeView<T extends Record<string, unknown>>(
	ComponentCtor: Component<T>,
	initialProps: T,
	options?: { contentDOM?: HTMLElement; stopEvent?: boolean }
): SvelteNodeViewHandle {
	const dom = document.createElement('div');
	dom.className = 'svelte-node-view';
	if (options?.contentDOM) {
		dom.appendChild(options.contentDOM);
	}

	let props = { ...initialProps };
	let component: ReturnType<typeof mount> | null = mount(ComponentCtor, { target: dom, props });

	const render = () => {
		if (component) unmount(component);
		component = mount(ComponentCtor, { target: dom, props });
	};

	return {
		dom,
		updateProps(next: Record<string, unknown>) {
			props = { ...props, ...next } as T;
			render();
		},
		destroy() {
			if (component) unmount(component);
			component = null;
		},
		select() {
			dom.classList.add('ProseMirror-selectednode');
			props = { ...props, selected: true } as T;
			render();
		},
		deselect() {
			dom.classList.remove('ProseMirror-selectednode');
			props = { ...props, selected: false } as T;
			render();
		}
	};
}
