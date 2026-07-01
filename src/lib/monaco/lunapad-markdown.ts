import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import {
	conf as markdownConf,
	language as markdownLanguage
} from 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js';
import { getMarkdocTagNames, MARKDOC_FUNCTIONS } from '$lib/services/markdoc-catalog';

export const LUNAPAD_MARKDOWN_LANG = 'lunapad-markdown';

const markdocTags = getMarkdocTagNames();
const markdocFunctions = Object.keys(MARKDOC_FUNCTIONS);

const markdocBodyRules: Monaco.languages.IMonarchLanguageRule[] = [
	[/\s+/, 'white'],
	[/\//, 'markdoc.delimiter'],
	[/%}/, { token: 'markdoc.delimiter', next: '@pop' }],
	[/"/, { token: 'string', next: '@markdocStringDouble' }],
	[/'/, { token: 'string', next: '@markdocStringSingle' }],
	[/\$[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/, 'markdoc.ref'],
	[/\d+(?:\.\d+)?/, 'number'],
	[/=/, 'markdoc.operator'],
	[
		/[a-zA-Z_]\w*/,
		{
			cases: {
				'@markdocFunctions': 'predefined',
				'@default': 'markdoc.attribute'
			}
		}
	]
];

const lunapadMarkdownLanguage: Monaco.languages.IMonarchLanguage = {
	...markdownLanguage,
	markdocTags,
	markdocFunctions,
	tokenizer: {
		...markdownLanguage.tokenizer,
		linecontent: [
			[/\{%/, { token: 'markdoc.delimiter', next: '@markdocOpen' }],
			...(markdownLanguage.tokenizer.linecontent as Monaco.languages.IMonarchLanguageRule[])
		],
		markdocOpen: [
			[/\s+/, 'white'],
			[/\//, 'markdoc.delimiter'],
			[
				/[a-zA-Z_]\w*/,
				{
					cases: {
						'@markdocTags': { token: 'markdoc.tag', next: '@markdocBody' },
						'@markdocFunctions': { token: 'predefined', next: '@markdocBody' },
						'@default': { token: 'markdoc.tag', next: '@markdocBody' }
					}
				}
			],
			[/%}/, { token: 'markdoc.delimiter', next: '@pop' }]
		],
		markdocBody: markdocBodyRules,
		markdocStringDouble: [
			[/[^\\"]+/, 'string'],
			[/\\./, 'string.escape'],
			[/"/, { token: 'string', next: '@pop' }]
		],
		markdocStringSingle: [
			[/[^\\']+/, 'string'],
			[/\\./, 'string.escape'],
			[/'/, { token: 'string', next: '@pop' }]
		]
	}
};

const lunapadMarkdownConf: Monaco.languages.LanguageConfiguration = {
	...markdownConf,
	surroundingPairs: [
		...(markdownConf.surroundingPairs ?? []),
		{ open: '"', close: '"' },
		{ open: "'", close: "'" }
	]
};

export function registerLunapadMarkdown(monaco: typeof Monaco): void {
	monaco.languages.register({
		id: LUNAPAD_MARKDOWN_LANG,
		extensions: ['.luna.md'],
		aliases: ['Lunapad Markdown', 'Markdoc', 'lunapad-markdown']
	});
	monaco.languages.setLanguageConfiguration(LUNAPAD_MARKDOWN_LANG, lunapadMarkdownConf);
	monaco.languages.setMonarchTokensProvider(LUNAPAD_MARKDOWN_LANG, lunapadMarkdownLanguage);
}
