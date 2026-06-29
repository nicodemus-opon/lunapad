// Converts numpydoc/RST-flavored docstrings (as returned raw by jedi for
// numpy/pandas/scipy-style libraries) into Markdown that Monaco's hover and
// suggest widgets render sensibly. Without this, indentation-based numpydoc
// sections (e.g. "Parameters\n----------\nname : type\n    description")
// collapse into a single unstructured paragraph once fed through a generic
// Markdown renderer, since soft line breaks don't preserve list structure.

const DEFINITION_SECTIONS = new Set([
	'Parameters',
	'Returns',
	'Other Parameters',
	'Raises',
	'Yields',
	'Attributes',
	'Methods'
]);

export function formatDocstring(raw: string): string {
	if (!raw || !raw.trim()) return '';
	const lines = raw.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const header = sectionHeaderAt(lines, i);
		if (header) {
			out.push(`\n#### ${formatInline(header)}\n`);
			i = emitSection(lines, i + 2, header, out);
			continue;
		}
		i = emitParagraphs(lines, i, out);
	}
	return out
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// numpydoc section headers are a setext-style title immediately followed by
// an underline of '-' or '=' at least as long as the title.
function sectionHeaderAt(lines: string[], i: number): string | null {
	const line = lines[i];
	const next = lines[i + 1];
	if (line === undefined || next === undefined) return null;
	if (/^\s/.test(line)) return null;
	const title = line.trim();
	const underline = next.trim();
	if (!title || !/^[-=]{3,}$/.test(underline)) return null;
	if (underline.length < Math.min(title.length, 3)) return null;
	return title;
}

function emitParagraphs(lines: string[], start: number, out: string[]): number {
	let i = start;
	let para: string[] = [];
	const flush = () => {
		if (!para.length) return;
		out.push(formatInline(para.join(' ')));
		out.push('');
		para = [];
	};
	while (i < lines.length) {
		if (sectionHeaderAt(lines, i)) {
			flush();
			return i;
		}
		const line = lines[i];
		if (line.trim() === '') {
			flush();
		} else {
			para.push(line.trim());
		}
		i++;
	}
	flush();
	return i;
}

function emitSection(lines: string[], start: number, name: string, out: string[]): number {
	if (!DEFINITION_SECTIONS.has(name)) return emitParagraphs(lines, start, out);

	let i = start;
	let current: { head: string; body: string[] } | null = null;
	const flush = () => {
		if (!current) return;
		const head = formatInline(current.head);
		const desc = current.body
			.map((l) => formatInline(l))
			.join(' ')
			.trim();
		const sep = head.indexOf(' : ');
		const headMd =
			sep === -1 ? `**${head}**` : `**${head.slice(0, sep)}** *${head.slice(sep + 3)}*`;
		out.push(`- ${headMd}${desc ? ` — ${desc}` : ''}`);
		current = null;
	};
	while (i < lines.length) {
		if (sectionHeaderAt(lines, i)) break;
		const line = lines[i];
		if (line.trim() === '') {
			i++;
			continue;
		}
		if (!/^\s/.test(line)) {
			flush();
			current = { head: line.trim(), body: [] };
		} else if (current) {
			current.body.push(line.trim());
		} else {
			out.push(formatInline(line.trim()));
		}
		i++;
	}
	flush();
	out.push('');
	return i;
}

function formatInline(text: string): string {
	return text
		.replace(/:ref:`([^`<]+?)\s*<[^`>]*>`/g, '$1')
		.replace(
			/:(?:py:)?(?:func|meth|class|attr|obj|mod|data|exc|term):`~?([^`]+)`/g,
			(_m, name: string) => `\`${name.split('.').pop()}\``
		)
		.replace(/^\.\.\s*versionchanged::\s*(.+)$/, '**Changed in $1:**')
		.replace(/^\.\.\s*versionadded::\s*(.+)$/, '**Added in $1:**')
		.replace(/^\.\.\s*deprecated::\s*(.+)$/, '**Deprecated since $1:**')
		.replace(/^\.\.\s*note::\s*$/, '**Note:**')
		.replace(/^\.\.\s*warning::\s*$/, '**Warning:**');
}
