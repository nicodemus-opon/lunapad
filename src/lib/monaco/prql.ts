import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

export const PRQL_KEYWORDS = [
	'from',
	'derive',
	'filter',
	'select',
	'group',
	'aggregate',
	'sort',
	'take',
	'join',
	'window',
	'let',
	'func',
	'case',
	'prql',
	'into',
	'loop',
	'type',
	'module',
	'internal',
	'in',
	'true',
	'false',
	'null',
	'this',
	'that',
	'side',
	'left',
	'right',
	'inner',
	'full',
	'append',
	'remove',
	'intersect'
];

export const PRQL_BUILTINS = [
	'average',
	'sum',
	'min',
	'max',
	'count',
	'count_distinct',
	'stddev',
	'every',
	'any',
	'all',
	'concat_array',
	'by',
	'rows',
	'range',
	'expanding',
	'rolling',
	'lag',
	'lead',
	'first',
	'last',
	'rank',
	'rank_dense',
	'row_number',
	'round',
	'abs',
	'floor',
	'ceil',
	'pi',
	'lower',
	'upper',
	'ltrim',
	'rtrim',
	'trim',
	'length',
	'extract',
	'contains',
	'starts_with',
	'ends_with',
	'coalesce',
	'as',
	'date'
];

export function registerPRQL(monaco: typeof Monaco): void {
	monaco.languages.register({ id: 'prql' });

	monaco.languages.setLanguageConfiguration('prql', {
		comments: { lineComment: '#' },
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: "'", close: "'", notIn: ['string', 'comment'] },
			{ open: '"', close: '"', notIn: ['string', 'comment'] },
			{ open: '`', close: '`', notIn: ['string', 'comment'] }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: "'", close: "'" },
			{ open: '"', close: '"' },
			{ open: '`', close: '`' }
		]
	});

	monaco.languages.setMonarchTokensProvider('prql', {
		defaultToken: '',
		keywords: PRQL_KEYWORDS,
		builtins: PRQL_BUILTINS,
		tokenizer: {
			root: [
				// comments (#! doc comments included)
				[/#.*$/, 'comment'],
				// date/time literals: @2024-01-01, @10:30, @2024-01-01T10:30:00Z
				[/@\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/, 'number'],
				[/@\d{2}:\d{2}(:\d{2}(\.\d+)?)?/, 'number'],
				// interpolated / special strings: f"...", s"...", r"..."
				[/[fsr]"""/, { token: 'string', next: '@tripleInterp' }],
				[/[fsr]"/, { token: 'string', next: '@stringInterpDouble' }],
				[/[fsr]'/, { token: 'string', next: '@stringInterpSingle' }],
				// plain strings
				[/"""/, { token: 'string', next: '@tripleString' }],
				[/"/, { token: 'string', next: '@stringDouble' }],
				[/'/, { token: 'string', next: '@stringSingle' }],
				// backtick-quoted identifiers
				[/`[^`]*`/, 'identifier'],
				// numbers (underscores allowed)
				[/0x[0-9a-fA-F_]+/, 'number'],
				[/0b[01_]+/, 'number'],
				[/0o[0-7_]+/, 'number'],
				[/\d[\d_]*\.\d[\d_]*([eE][+-]?\d+)?/, 'number.float'],
				[/\d[\d_]*([eE][+-]?\d+)?/, 'number'],
				// keywords / builtins / identifiers
				[
					/[a-zA-Z_][\w]*/,
					{
						cases: {
							'@keywords': 'keyword',
							'@builtins': 'predefined',
							'@default': 'identifier'
						}
					}
				],
				// operators (pipe is structurally significant in PRQL)
				[/->|=>|==|!=|>=|<=|~=|&&|\|\||\?\?|\/\/|[+\-*/%=<>!|]/, 'operator'],
				// delimiters
				[/[{}()[\],.:;]/, 'delimiter']
			],
			stringDouble: [
				[/[^\\"]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, { token: 'string', next: '@pop' }]
			],
			stringSingle: [
				[/[^\\']+/, 'string'],
				[/\\./, 'string.escape'],
				[/'/, { token: 'string', next: '@pop' }]
			],
			tripleString: [
				[/"""/, { token: 'string', next: '@pop' }],
				[/./, 'string']
			],
			stringInterpDouble: [
				[/\{[^}]*\}/, 'string.escape'],
				[/[^\\"{]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, { token: 'string', next: '@pop' }]
			],
			stringInterpSingle: [
				[/\{[^}]*\}/, 'string.escape'],
				[/[^\\'{]+/, 'string'],
				[/\\./, 'string.escape'],
				[/'/, { token: 'string', next: '@pop' }]
			],
			tripleInterp: [
				[/"""/, { token: 'string', next: '@pop' }],
				[/\{[^}]*\}/, 'string.escape'],
				[/./, 'string']
			]
		}
	});
}
