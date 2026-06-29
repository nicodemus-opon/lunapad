export interface DiffLine {
	kind: 'same' | 'removed' | 'added';
	line: string;
}

/** Compute a simple line-level diff between old and new code for display. */
export function buildDiff(oldCode: string, newCode: string): DiffLine[] {
	const oldLines = oldCode.split('\n');
	const newLines = newCode.split('\n');
	const result: DiffLine[] = [];
	const maxLen = Math.max(oldLines.length, newLines.length);
	for (let i = 0; i < maxLen; i++) {
		const o = oldLines[i];
		const n = newLines[i];
		if (o === n) {
			result.push({ kind: 'same', line: o ?? '' });
		} else {
			if (o !== undefined) result.push({ kind: 'removed', line: o });
			if (n !== undefined) result.push({ kind: 'added', line: n });
		}
	}
	return result;
}
