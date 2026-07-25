import type { GitCommitLogEntry } from '$lib/types/git';

export interface CommitLane {
	hash: string;
	lane: number;
	/** Lane each parent occupies (for drawing a connector from this row down to
	 *  the next row it appears in) — parallel to the commit's own parent list. */
	parentLanes: { hash: string; lane: number }[];
	/** Lanes with an open pending connector that run straight through this row
	 *  without involving this commit (other branches still in flight). */
	passthroughLanes: number[];
}

/** Assigns each commit a horizontal "lane" (like `git log --graph`'s ASCII rail,
 *  or GitHub's commit graph), given commits newest-first with parent hashes.
 *  Lanes are computed top-down: a commit takes over the lane of whichever
 *  open lane was "expecting" it (i.e. is one of an already-placed commit's
 *  parents), or opens a new one. Its first parent continues in the same lane
 *  (standard git convention); additional parents (merges) get their own lane,
 *  reusing a freed one where possible. */
export function layoutCommitGraph(commits: GitCommitLogEntry[]): CommitLane[] {
	const lanes: (string | null)[] = [];
	const result: CommitLane[] = [];

	function claimLaneFor(hash: string): number {
		const existing = lanes.findIndex((expected) => expected === hash);
		if (existing !== -1) return existing;
		const free = lanes.findIndex((expected) => expected === null);
		if (free !== -1) return free;
		lanes.push(null);
		return lanes.length - 1;
	}

	for (const commit of commits) {
		const lanesBefore = lanes.slice();
		const lane = claimLaneFor(commit.hash);

		// More than one lane can be expecting this exact hash — e.g. two
		// branches that both point straight back to the same ancestor without
		// any commits of their own in between. Collapse all of them onto
		// `lane` now; otherwise the others linger as phantom passthroughs for
		// the rest of the graph, since nothing will ever match their
		// expectation again.
		const resolvedLanes = new Set<number>([lane]);
		for (let i = 0; i < lanes.length; i++) {
			if (lanes[i] === commit.hash) {
				lanes[i] = null;
				resolvedLanes.add(i);
			}
		}

		const passthroughLanes = lanesBefore
			.map((v, i) => (v !== null && !resolvedLanes.has(i) ? i : -1))
			.filter((i) => i !== -1);

		const parentLanes: { hash: string; lane: number }[] = [];
		commit.parents.forEach((parentHash, i) => {
			const pLane = i === 0 ? lane : claimLaneFor(parentHash);
			lanes[pLane] = parentHash;
			parentLanes.push({ hash: parentHash, lane: pLane });
		});

		result.push({ hash: commit.hash, lane, parentLanes, passthroughLanes });
	}

	return result;
}
