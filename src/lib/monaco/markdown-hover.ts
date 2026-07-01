import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import {
	MARKDOC_FUNCTIONS,
	MARKDOC_REF_PSEUDO_FIELDS,
	MARKDOC_TAG_CATALOG
} from '$lib/services/markdoc-catalog';
import { getMarkdownModelRefs } from './markdown-completions';

export function registerMarkdownHover(m: typeof Monaco): void {
	m.languages.registerHoverProvider('markdown', {
		provideHover(model, position) {
			const line = model.getLineContent(position.lineNumber);
			const textBefore = line.slice(0, position.column - 1);
			const textAfter = line.slice(position.column - 1);

			// $cell.field hover
			const refMatch = textBefore.match(/\$(\w+)(?:\.(\w+))?$/);
			if (refMatch) {
				const cellName = refMatch[1];
				const field = refMatch[2] ?? textAfter.match(/^\.(\w+)/)?.[1];
				const refs = getMarkdownModelRefs(model.uri.toString());
				const entry = refs.find((r) => r.cellName === cellName);

				let detail: string;
				if (!field) {
					detail = `Live ref to query cell **${cellName}**. Add \`.column\`, \`.rows\`, or \`.count\`.`;
				} else {
					const pseudo = MARKDOC_REF_PSEUDO_FIELDS.find((f) => f.name === field);
					if (pseudo) {
						detail = pseudo.detail;
					} else {
						const col = entry?.columns.find((c) => c.name === field);
						detail = col
							? `First-row value from **${cellName}.${field}**${col.type ? ` (\`${col.type}\`)` : ''}`
							: `Field **${field}** on cell **${cellName}**`;
					}
				}

				const startCol = position.column - (refMatch[0].length + (field ? field.length + 1 : 0));
				return {
					range: new m.Range(
						position.lineNumber,
						Math.max(1, startCol),
						position.lineNumber,
						position.column + (field ? 0 : (textAfter.match(/^\.(\w+)/)?.[0]?.length ?? 0))
					),
					contents: [{ value: detail }]
				};
			}

			// {% tagname hover
			const tagMatch = textBefore.match(/\{%\s*\/?(\w+)/);
			if (tagMatch) {
				const tagName = tagMatch[1];
				const tag = MARKDOC_TAG_CATALOG[tagName];
				if (tag) {
					const attrLines = tag.attributes
						? Object.entries(tag.attributes)
								.map(([name, attr]) => {
									const req = attr.required ? ' *(required)*' : '';
									const en = attr.enum ? ` — \`${attr.enum.join(' | ')}\`` : '';
									return `- **${name}**${req}: ${attr.detail ?? ''}${en}`;
								})
								.join('\n')
						: '';
					const value = [`**{% ${tagName} %}** — ${tag.detail}`, attrLines]
						.filter(Boolean)
						.join('\n\n');
					return {
						range: new m.Range(
							position.lineNumber,
							Math.max(1, position.column - tagName.length),
							position.lineNumber,
							position.column
						),
						contents: [{ value }]
					};
				}
			}

			// Function hover
			const word = model.getWordAtPosition(position);
			if (word && MARKDOC_FUNCTIONS[word.word]) {
				const fn = MARKDOC_FUNCTIONS[word.word];
				return {
					range: new m.Range(
						position.lineNumber,
						word.startColumn,
						position.lineNumber,
						word.endColumn
					),
					contents: [{ value: `**\`${fn.signature}\`**\n\n${fn.detail}` }]
				};
			}

			return null;
		}
	});
}
