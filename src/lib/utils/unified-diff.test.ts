import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, diffTexts } from './unified-diff.js';

describe('parseUnifiedDiff', () => {
	it('returns no hunks for an empty diff', () => {
		expect(parseUnifiedDiff('')).toEqual({ hunks: [], isBinary: false });
		expect(parseUnifiedDiff('   \n  ')).toEqual({ hunks: [], isBinary: false });
	});

	it('flags binary files without attempting to parse hunks', () => {
		const diff = 'Binary files a/image.png and b/image.png differ\n';
		expect(parseUnifiedDiff(diff)).toEqual({ hunks: [], isBinary: true });
	});

	it('parses a simple single-hunk modification', () => {
		const diff = [
			'diff --git a/foo.txt b/foo.txt',
			'index 1234567..89abcde 100644',
			'--- a/foo.txt',
			'+++ b/foo.txt',
			'@@ -1,3 +1,3 @@',
			' line one',
			'-line two',
			'+line TWO',
			' line three',
			''
		].join('\n');
		const parsed = parseUnifiedDiff(diff);
		expect(parsed.isBinary).toBe(false);
		expect(parsed.hunks).toHaveLength(1);
		const hunk = parsed.hunks[0];
		expect(hunk.oldStart).toBe(1);
		expect(hunk.oldLines).toBe(3);
		expect(hunk.newStart).toBe(1);
		expect(hunk.newLines).toBe(3);
		expect(hunk.linesSkippedBefore).toBe(0);
		expect(hunk.rows).toEqual([
			{ kind: 'context', oldLine: 1, newLine: 1, text: 'line one' },
			{ kind: 'removed', oldLine: 2, newLine: null, text: 'line two' },
			{ kind: 'added', oldLine: null, newLine: 2, text: 'line TWO' },
			{ kind: 'context', oldLine: 3, newLine: 3, text: 'line three' }
		]);
	});

	it('parses an add-only diff (new file / added lines)', () => {
		const diff = [
			'--- a/foo.txt',
			'+++ b/foo.txt',
			'@@ -1,2 +1,4 @@',
			' line one',
			'+new line a',
			'+new line b',
			' line two',
			''
		].join('\n');
		const parsed = parseUnifiedDiff(diff);
		const added = parsed.hunks[0].rows.filter((r) => r.kind === 'added');
		expect(added).toEqual([
			{ kind: 'added', oldLine: null, newLine: 2, text: 'new line a' },
			{ kind: 'added', oldLine: null, newLine: 3, text: 'new line b' }
		]);
	});

	it('parses a delete-only diff', () => {
		const diff = [
			'--- a/foo.txt',
			'+++ b/foo.txt',
			'@@ -1,3 +1,1 @@',
			' line one',
			'-line two',
			'-line three',
			''
		].join('\n');
		const parsed = parseUnifiedDiff(diff);
		const removed = parsed.hunks[0].rows.filter((r) => r.kind === 'removed');
		expect(removed).toEqual([
			{ kind: 'removed', oldLine: 2, newLine: null, text: 'line two' },
			{ kind: 'removed', oldLine: 3, newLine: null, text: 'line three' }
		]);
	});

	it('parses a rename with modification (still just hunks against new path)', () => {
		const diff = [
			'diff --git a/old-name.sql b/new-name.sql',
			'similarity index 90%',
			'rename from old-name.sql',
			'rename to new-name.sql',
			'index 1111111..2222222 100644',
			'--- a/old-name.sql',
			'+++ b/new-name.sql',
			'@@ -1,2 +1,2 @@',
			' select 1',
			'-from a',
			'+from b',
			''
		].join('\n');
		const parsed = parseUnifiedDiff(diff);
		expect(parsed.hunks).toHaveLength(1);
		expect(parsed.hunks[0].rows.some((r) => r.kind === 'removed' && r.text === 'from a')).toBe(
			true
		);
	});

	it('tracks skipped-line count between multiple hunks in one file', () => {
		const diff = [
			'--- a/foo.txt',
			'+++ b/foo.txt',
			'@@ -1,2 +1,2 @@',
			' line 1',
			'-line 2 old',
			'+line 2 new',
			'@@ -20,2 +20,2 @@',
			' line 20',
			'-line 21 old',
			'+line 21 new',
			''
		].join('\n');
		const parsed = parseUnifiedDiff(diff);
		expect(parsed.hunks).toHaveLength(2);
		expect(parsed.hunks[0].linesSkippedBefore).toBe(0);
		// second hunk starts at old line 20; first hunk covered old lines 1-2, so 17 lines skipped
		expect(parsed.hunks[1].linesSkippedBefore).toBe(17);
	});

	it('handles the synthesized whole-file diff git produces for untracked files', () => {
		const diff = [
			'diff --git a/new-file.sql b/new-file.sql',
			'new file mode 100644',
			'index 0000000..1111111',
			'--- /dev/null',
			'+++ b/new-file.sql',
			'@@ -0,0 +1,2 @@',
			'+select 1',
			'+select 2',
			''
		].join('\n');
		const parsed = parseUnifiedDiff(diff);
		expect(parsed.hunks).toHaveLength(1);
		expect(parsed.hunks[0].rows).toEqual([
			{ kind: 'added', oldLine: null, newLine: 1, text: 'select 1' },
			{ kind: 'added', oldLine: null, newLine: 2, text: 'select 2' }
		]);
	});
});

describe('diffTexts', () => {
	it('returns no hunks when texts are identical', () => {
		expect(diffTexts('select 1', 'select 1')).toEqual({ hunks: [], isBinary: false });
	});

	it('diffs two full-text strings directly', () => {
		const oldText = 'a\nb\nc\n';
		const newText = 'a\nB\nc\n';
		const parsed = diffTexts(oldText, newText);
		expect(parsed.hunks).toHaveLength(1);
		const kinds = parsed.hunks[0].rows.map((r) => `${r.kind}:${r.text}`);
		expect(kinds).toContain('removed:b');
		expect(kinds).toContain('added:B');
	});
});
