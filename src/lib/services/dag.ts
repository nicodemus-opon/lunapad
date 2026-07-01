export interface ModelNode {
	id: string;
	relationName: string;
	prql: string;
}

export interface ModelEdge {
	from: string;
	to: string;
	reason: 'inferred-from';
	sourceRelation: string;
}

export interface InferredDag {
	nodes: ModelNode[];
	edges: ModelEdge[];
}

export type DagRunSelector = 'selected' | 'upstream' | 'downstream' | 'neighborhood';

export interface DagRunPlan {
	nodeIds: string[];
	orderedNodeIds: string[];
	hasCycle: boolean;
}

function normalizeName(name: string): string {
	return name.trim().replace(/^`(.*)`$/, '$1');
}

function stripInlineComment(line: string): string {
	let inQuote = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '\\' && inQuote) {
			i++;
			continue;
		}
		if (ch === '"') {
			inQuote = !inQuote;
			continue;
		}
		if (ch === '#' && !inQuote) return line.slice(0, i);
	}
	return line;
}

export function extractDependenciesFromPRQL(prql: string): string[] {
	const deps = new Set<string>();
	const lines = prql
		.split('\n')
		.map((line) => stripInlineComment(line).trim())
		.filter(Boolean);

	for (const line of lines) {
		const fromMatch = /^from\s+(?:[A-Za-z_][A-Za-z0-9_]*=)?([^\s]+)$/i.exec(line);
		if (fromMatch) deps.add(normalizeName(fromMatch[1]));

		const joinMatch =
			/^join\s+(?:side:(?:inner|left|right|full)\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=)?([^\s(]+)/i.exec(
				line
			);
		if (joinMatch) deps.add(normalizeName(joinMatch[1]));
	}

	return [...deps];
}

export function buildInferredDag(nodes: ModelNode[]): InferredDag {
	const relationToNodeIds = new Map<string, string[]>();
	for (const n of nodes) {
		const key = normalizeName(n.relationName);
		const arr = relationToNodeIds.get(key) ?? [];
		arr.push(n.id);
		relationToNodeIds.set(key, arr);
	}

	const edgeKey = new Set<string>();
	const edges: ModelEdge[] = [];

	for (const node of nodes) {
		const deps = extractDependenciesFromPRQL(node.prql);
		for (const dep of deps) {
			const sourceIds = relationToNodeIds.get(dep) ?? [];
			for (const sourceId of sourceIds) {
				if (sourceId === node.id) continue;
				const key = `${sourceId}->${node.id}:${dep}`;
				if (edgeKey.has(key)) continue;
				edgeKey.add(key);
				edges.push({
					from: sourceId,
					to: node.id,
					reason: 'inferred-from',
					sourceRelation: dep
				});
			}
		}
	}

	return { nodes: [...nodes], edges };
}

function traverse(seedIds: string[], adj: Map<string, string[]>): Set<string> {
	const visited = new Set<string>(seedIds);
	const queue = [...seedIds];
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const next of adj.get(current) ?? []) {
			if (!visited.has(next)) {
				visited.add(next);
				queue.push(next);
			}
		}
	}
	return visited;
}

function topologicalOrder(
	nodeIds: Set<string>,
	edges: ModelEdge[]
): { ordered: string[]; hasCycle: boolean } {
	const indegree = new Map<string, number>();
	const nextMap = new Map<string, string[]>();
	for (const id of nodeIds) {
		indegree.set(id, 0);
		nextMap.set(id, []);
	}

	for (const e of edges) {
		if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
		nextMap.get(e.from)!.push(e.to);
		indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
	}

	const queue = [...indegree.entries()]
		.filter(([, deg]) => deg === 0)
		.map(([id]) => id)
		.sort();

	const ordered: string[] = [];
	while (queue.length > 0) {
		const id = queue.shift()!;
		ordered.push(id);
		for (const next of nextMap.get(id) ?? []) {
			const deg = (indegree.get(next) ?? 0) - 1;
			indegree.set(next, deg);
			if (deg === 0) {
				queue.push(next);
				queue.sort();
			}
		}
	}

	return { ordered, hasCycle: ordered.length !== nodeIds.size };
}

export function planDagRun(
	dag: InferredDag,
	selectedNodeIds: string[],
	selector: DagRunSelector
): DagRunPlan {
	const selected = new Set(selectedNodeIds.filter(Boolean));
	if (selected.size === 0) {
		return { nodeIds: [], orderedNodeIds: [], hasCycle: false };
	}

	const downstreamMap = new Map<string, string[]>();
	const upstreamMap = new Map<string, string[]>();
	for (const n of dag.nodes) {
		downstreamMap.set(n.id, []);
		upstreamMap.set(n.id, []);
	}
	for (const e of dag.edges) {
		if (!downstreamMap.has(e.from) || !upstreamMap.has(e.to)) continue;
		downstreamMap.get(e.from)!.push(e.to);
		upstreamMap.get(e.to)!.push(e.from);
	}

	let included = new Set<string>(selected);
	if (selector === 'upstream') {
		included = traverse([...selected], upstreamMap);
	} else if (selector === 'downstream') {
		included = traverse([...selected], downstreamMap);
	} else if (selector === 'neighborhood') {
		const up = traverse([...selected], upstreamMap);
		const down = traverse([...selected], downstreamMap);
		included = new Set([...up, ...down]);
	}

	const { ordered, hasCycle } = topologicalOrder(included, dag.edges);
	return {
		nodeIds: [...included],
		orderedNodeIds: ordered,
		hasCycle
	};
}
