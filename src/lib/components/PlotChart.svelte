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

	$effect(() => {
		if (!el || width === 0 || height === 0) return;
		const node = render(width, height);
		el.replaceChildren(node);
	});
</script>

<div bind:this={el} style="width:100%;height:100%"></div>
