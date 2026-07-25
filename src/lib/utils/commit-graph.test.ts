import { describe, it, expect } from 'vitest';
import { layoutCommitGraph } from './commit-graph.js';
import type { GitCommitLogEntry } from '$lib/types/git.js';

function commit(hash: string, parents: string[]): GitCommitLogEntry {
	return { hash, author: 'a', date: '2026-01-01', message: hash, parents };
}

describe('layoutCommitGraph', () => {
	it('keeps a linear history in a single lane', () => {
		// C3 -> C2 -> C1 -> C0 (newest first)
		const commits = [
			commit('c3', ['c2']),
			commit('c2', ['c1']),
			commit('c1', ['c0']),
			commit('c0', [])
		];
		const lanes = layoutCommitGraph(commits);
		expect(lanes.map((l) => l.lane)).toEqual([0, 0, 0, 0]);
	});

	it('gives a merge commit two parent lanes and reconverges after the branch is consumed', () => {
		// merge -> [main1, feature1]; main1 -> base; feature1 -> base
		const commits = [
			commit('merge', ['main1', 'feature1']),
			commit('main1', ['base']),
			commit('feature1', ['base']),
			commit('base', [])
		];
		const lanes = layoutCommitGraph(commits);
		const byHash = Object.fromEntries(lanes.map((l) => [l.hash, l]));

		expect(byHash.merge.lane).toBe(0);
		expect(byHash.merge.parentLanes).toEqual([
			{ hash: 'main1', lane: 0 },
			{ hash: 'feature1', lane: 1 }
		]);
		// main1 continues straight down in lane 0
		expect(byHash.main1.lane).toBe(0);
		// feature1 occupies the lane opened for it by the merge commit
		expect(byHash.feature1.lane).toBe(1);
		// both converge on "base" — whichever commit reaches it first claims its
		// lane, and the other lane collapses onto the same commit
		expect(byHash.base.lane === 0 || byHash.base.lane === 1).toBe(true);
	});

	it('reuses a freed lane rather than growing unboundedly', () => {
		// Two short-lived diverging branches that each merge back quickly.
		const commits = [
			commit('m2', ['c2', 'f2']),
			commit('f2', ['base']),
			commit('c2', ['m1']),
			commit('m1', ['c1', 'f1']),
			commit('f1', ['base']),
			commit('c1', ['base']),
			commit('base', [])
		];
		const lanes = layoutCommitGraph(commits);
		const maxLane = Math.max(...lanes.map((l) => l.lane));
		// f2's pending connector to "base" legitimately pins a lane open while
		// m1 forks into c1/f1, so 3 concurrent lanes (0,1,2) is the correct
		// minimum here — this only guards against unbounded lane growth, not
		// reuse of that one pinned lane.
		expect(maxLane).toBeLessThanOrEqual(2);
	});

	it('collapses multiple lanes that converge on the exact same ancestor, without leaving a phantom passthrough', () => {
		// Two branches each go straight back to "base" with no commits of
		// their own in between (mirrors a real repro: merge -> main1, feature1
		// -> both parent directly to base).
		const commits = [
			commit('merge', ['main1', 'feature1']),
			commit('main1', ['base']),
			commit('feature1', ['base']),
			commit('base', ['root']),
			commit('root', [])
		];
		const lanes = layoutCommitGraph(commits);
		const byHash = Object.fromEntries(lanes.map((l) => [l.hash, l]));

		// "base" resolves both lanes at once — nothing should still be
		// waiting on it afterward.
		expect(byHash.root.passthroughLanes).toEqual([]);
	});

	it('handles the root commit with no parents', () => {
		const commits = [commit('only', [])];
		const lanes = layoutCommitGraph(commits);
		expect(lanes).toEqual([{ hash: 'only', lane: 0, parentLanes: [], passthroughLanes: [] }]);
	});
});
