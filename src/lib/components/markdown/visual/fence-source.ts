/** Pure helpers for reading/writing the raw markdown fence text stored in a
 * `markdocBlock` node's `source` attr (e.g. "```sql\nselect 1\n```"). Used by
 * FenceBlockView to present the fence as an editable code+language pair
 * without changing the node's on-disk attr shape. */

export interface ParsedFence {
	/** Delimiter run, e.g. "```" or "~~~~". */
	fence: string;
	/** Language token right after the opening delimiter (may be empty). */
	lang: string;
	code: string;
}

const FENCE_RE = /^(`{3,}|~{3,})[ \t]*(\S*)[ \t]*\n([\s\S]*?)\n?\1[ \t]*$/;

export function isFenceSource(source: string): boolean {
	return FENCE_RE.test(source.trim());
}

export function parseFenceSource(source: string): ParsedFence | null {
	const m = source.trim().match(FENCE_RE);
	if (!m) return null;
	return { fence: m[1], lang: m[2] ?? '', code: m[3] ?? '' };
}

/** Reconstructs a fenced string, bumping the backtick run length if `code`
 * itself contains a run of backticks that would otherwise close the fence early. */
export function buildFenceSource(lang: string, code: string, fence = '```'): string {
	let safeFence = fence;
	if (safeFence.startsWith('`')) {
		const runs = code.match(/`+/g) ?? [];
		const longestRun = runs.reduce((max, r) => Math.max(max, r.length), 0);
		while (safeFence.length <= longestRun) safeFence += '`';
	}
	return `${safeFence}${lang}\n${code}\n${safeFence}`;
}

/** Fence language token -> registered Monaco language id. Unregistered
 * languages fall back to 'plaintext' (Monaco still renders fine, just
 * without syntax highlighting). */
const LANG_ALIASES: Record<string, string> = {
	sql: 'sql',
	postgres: 'sql',
	postgresql: 'sql',
	mysql: 'sql',
	python: 'python',
	py: 'python',
	prql: 'prql',
	js: 'javascript',
	javascript: 'javascript',
	jsx: 'javascript',
	ts: 'typescript',
	typescript: 'typescript',
	tsx: 'typescript',
	yaml: 'yaml',
	yml: 'yaml',
	sh: 'shell',
	bash: 'shell',
	shell: 'shell',
	zsh: 'shell',
	html: 'html',
	css: 'css',
	dockerfile: 'dockerfile',
	md: 'markdown',
	markdown: 'markdown'
};

export function monacoLanguageForFenceLang(lang: string): string {
	return LANG_ALIASES[lang.trim().toLowerCase()] ?? 'plaintext';
}
