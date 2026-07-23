/** Nearest element for a DOM event (handles text-node targets). Shared by
 * atom NodeViews that embed interactive content (Monaco, GUI controls) and
 * need to scope `stopEvent` to their own DOM subtree instead of swallowing
 * every event inside the node. */
export function eventTargetElement(event: Event): Element | null {
	let node = event.target as globalThis.Node | null;
	while (node && node.nodeType !== globalThis.Node.ELEMENT_NODE) {
		node = node.parentNode;
	}
	return node as Element | null;
}
