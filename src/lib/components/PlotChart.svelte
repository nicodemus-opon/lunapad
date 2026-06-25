<script lang="ts">
	interface Props {
		render: (width: number, height: number) => Element;
	}

	const { render }: Props = $props();

	let el: HTMLDivElement | undefined = $state();
	let width = $state(0);
	let height = $state(0);

	$effect(() => {
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const box = entries[0]?.contentRect;
			if (box) {
				width = box.width;
				height = box.height;
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	// Plot.plot() returns a brand-new SVG/HTML element on every call — there's no
	// stable DOM to morph attribute-by-attribute (true FLIP isn't viable here), so
	// "animating" means crossfading the old node out and the new one in at the
	// container level. We only want that crossfade when the underlying data/config
	// actually changed, not on a pure resize: `render` is a `$derived.by` closure in
	// ChartView.svelte that only gets a new reference when its data dependencies
	// change, so `render !== previousRender` is a reliable proxy for "data changed"
	// even though this effect also re-runs on every width/height tick.
	let previousRender: ((w: number, h: number) => Element) | undefined;

	function motionDurationMs(): number {
		const raw = getComputedStyle(document.documentElement)
			.getPropertyValue('--motion-medium')
			.trim();
		const ms = parseFloat(raw);
		return Number.isFinite(ms) ? ms : 220;
	}

	function crossfade(container: HTMLElement, newNode: Element): void {
		const ease = 'var(--motion-ease-out, cubic-bezier(0.16,1,0.3,1))';
		const duration = motionDurationMs();
		const previousChildren = [...container.children];
		// Plot sets its own inline `style` (font/background/color) on the
		// returned element — preserve it and restore it verbatim once the fade
		// finishes, rather than leaving the transition/positioning styles
		// permanently attached (which otherwise lingers as dead weight on every
		// chart, and risks confusing anything that inspects the element's style
		// later, e.g. PNG export's computed-style inliner).
		const originalStyle = newNode.getAttribute('style') ?? '';

		// Absolutely position the incoming node over the outgoing one so they
		// overlap exactly during the fade instead of stacking in block flow —
		// the container has an explicit width/height from its own inline style,
		// so it doesn't need the old node in flow to stay correctly sized.
		newNode.setAttribute(
			'style',
			`${originalStyle};position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity ${duration}ms ${ease}`
		);
		container.appendChild(newNode);
		container.setAttribute('data-mid-transition', 'true');

		// Force layout so the opacity:0 → 1 flip below is actually transitioned
		// rather than collapsed into the same paint frame.
		void newNode.getBoundingClientRect();
		requestAnimationFrame(() => {
			newNode.setAttribute(
				'style',
				`${originalStyle};position:absolute;inset:0;width:100%;height:100%;opacity:1;transition:opacity ${duration}ms ${ease}`
			);
		});

		const cleanup = () => {
			for (const child of previousChildren) child.remove();
			container.removeAttribute('data-mid-transition');
			newNode.setAttribute('style', originalStyle);
		};
		newNode.addEventListener('transitionend', cleanup, { once: true });
		// Fallback in case transitionend doesn't fire (e.g. duration collapsed to
		// ~0 under prefers-reduced-motion, or the element has no layout box yet).
		setTimeout(cleanup, duration + 50);
	}

	$effect(() => {
		if (!el || width === 0 || height === 0) return;
		const isDataChange = render !== previousRender;
		previousRender = render;
		const node = render(width, height);
		if (isDataChange) {
			crossfade(el, node);
		} else {
			// Pure resize: replace synchronously, no animation — avoids jank while
			// dragging panel splitters or resizing the window.
			el.replaceChildren(node);
		}
	});
</script>

<div bind:this={el} style="width:100%;height:100%;position:relative"></div>
