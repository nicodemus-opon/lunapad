import { describe, expect, it } from 'vitest';

import {
	buildInferredDag,
	extractDependenciesFromPRQL,
	planDagRun,
	type InferredDag
} from '$lib/services/dag';

describe('extractDependenciesFromPRQL', () => {
	it('extracts from and join dependencies', () => {
		const prql = `from stg_orders\njoin c=dim_customers (==customer_id)\nfilter amount > 0`;
		expect(extractDependenciesFromPRQL(prql).sort()).toEqual(['dim_customers', 'stg_orders']);
	});
});

describe('buildInferredDag', () => {
	it('creates inferred edges based on relation usage', () => {
		const dag = buildInferredDag([
			{ id: 'a', relationName: 'stg_orders', prql: 'from raw_orders' },
			{
				id: 'b',
				relationName: 'fct_orders',
				prql: 'from stg_orders\njoin dim_customers (==customer_id)'
			},
			{ id: 'c', relationName: 'dim_customers', prql: 'from raw_customers' }
		]);

		expect(dag.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: 'a', to: 'b', sourceRelation: 'stg_orders' }),
				expect.objectContaining({ from: 'c', to: 'b', sourceRelation: 'dim_customers' })
			])
		);
	});
});

function makeLinearDag(): InferredDag {
	return {
		nodes: [
			{ id: 'a', relationName: 'a', prql: '' },
			{ id: 'b', relationName: 'b', prql: '' },
			{ id: 'c', relationName: 'c', prql: '' },
			{ id: 'd', relationName: 'd', prql: '' }
		],
		edges: [
			{ from: 'a', to: 'b', reason: 'inferred-from', sourceRelation: 'a' },
			{ from: 'b', to: 'c', reason: 'inferred-from', sourceRelation: 'b' },
			{ from: 'c', to: 'd', reason: 'inferred-from', sourceRelation: 'c' }
		]
	};
}

describe('planDagRun', () => {
	it('selects only selected nodes', () => {
		const plan = planDagRun(makeLinearDag(), ['c'], 'selected');
		expect(plan.nodeIds).toEqual(['c']);
		expect(plan.orderedNodeIds).toEqual(['c']);
	});

	it('selects upstream lineage', () => {
		const plan = planDagRun(makeLinearDag(), ['c'], 'upstream');
		expect(new Set(plan.nodeIds)).toEqual(new Set(['a', 'b', 'c']));
		expect(plan.orderedNodeIds).toEqual(['a', 'b', 'c']);
	});

	it('selects downstream lineage', () => {
		const plan = planDagRun(makeLinearDag(), ['b'], 'downstream');
		expect(new Set(plan.nodeIds)).toEqual(new Set(['b', 'c', 'd']));
		expect(plan.orderedNodeIds).toEqual(['b', 'c', 'd']);
	});

	it('selects neighborhood lineage', () => {
		const plan = planDagRun(makeLinearDag(), ['c'], 'neighborhood');
		expect(new Set(plan.nodeIds)).toEqual(new Set(['a', 'b', 'c', 'd']));
		expect(plan.orderedNodeIds).toEqual(['a', 'b', 'c', 'd']);
	});

	it('reports cycle in selection', () => {
		const cyclicDag: InferredDag = {
			nodes: [
				{ id: 'a', relationName: 'a', prql: '' },
				{ id: 'b', relationName: 'b', prql: '' }
			],
			edges: [
				{ from: 'a', to: 'b', reason: 'inferred-from', sourceRelation: 'a' },
				{ from: 'b', to: 'a', reason: 'inferred-from', sourceRelation: 'b' }
			]
		};
		const plan = planDagRun(cyclicDag, ['a'], 'neighborhood');
		expect(plan.hasCycle).toBe(true);
	});
});
