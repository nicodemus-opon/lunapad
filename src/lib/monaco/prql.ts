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

// One-line docs for hover — covers keywords/builtins where the name alone
// isn't self-explanatory (skips trivial literals like `true`/`false`/`null`).
export const PRQL_DOCS: Record<string, string> = {
	from: 'Start a pipeline from a table or CTE.',
	derive: 'Add one or more new columns, computed from existing columns.',
	filter: 'Keep only rows matching a condition.',
	select: 'Choose which columns to keep (and optionally rename/reorder them).',
	group: 'Partition rows by one or more columns before an `aggregate`.',
	aggregate: 'Reduce each group (or the whole table) to a single row using aggregate functions.',
	sort: 'Order rows by one or more columns; prefix a column with `-` for descending.',
	take: 'Limit to the first N rows, or a range like `10..20`.',
	join: 'Combine with another table. `join side:left other (condition)`.',
	window: 'Apply transforms (derive/sort/etc.) within a rolling/expanding row window.',
	let: 'Define a named CTE-like step that can be referenced later in the pipeline.',
	func: 'Define a reusable custom function.',
	case: 'Pick a value based on the first matching condition, like SQL CASE WHEN.',
	prql: 'A header annotation, e.g. `prql target:sql.duckdb`.',
	into: 'Name the output of a step for later reference.',
	loop: 'Repeat a pipeline step, accumulating results (recursive CTE).',
	type: 'Declare a custom type.',
	module: 'Group declarations into a namespace.',
	internal: 'Reference PRQL’s internal/built-in functions.',
	in: 'Test membership, e.g. `x in [1, 2, 3]`.',
	this: 'Reference the current row/table in the current pipeline step.',
	that: 'Reference the table from before a `join`.',
	side: 'Join kind parameter: `left`, `right`, `inner`, or `full`.',
	left: 'Left join — keep all rows from this side.',
	right: 'Right join — keep all rows from the other side.',
	inner: 'Inner join — keep only matching rows from both sides.',
	full: 'Full outer join — keep all rows from both sides.',
	append: 'Concatenate rows from another table (like SQL UNION ALL).',
	remove: 'Remove rows that match another table (like SQL EXCEPT).',
	intersect: 'Keep only rows that also appear in another table.',
	average: 'Mean of a column within the current group.',
	sum: 'Sum of a column within the current group.',
	min: 'Minimum value of a column within the current group.',
	max: 'Maximum value of a column within the current group.',
	count: 'Number of rows within the current group.',
	count_distinct: 'Number of distinct values of a column within the current group.',
	stddev: 'Standard deviation of a column within the current group.',
	every: 'True if the condition is true for every row in the group.',
	any: 'True if the condition is true for any row in the group.',
	all: 'True if the condition is true for every row in the group.',
	concat_array: 'Concatenate values into an array within the current group.',
	by: 'Partition key for `window`, e.g. `window by:category (...)`.',
	rows: 'Row-based window frame, e.g. `rows:-3..3`.',
	range: 'Value-based window frame for `window`.',
	expanding: 'Window frame that grows from the start of the partition to the current row.',
	rolling: 'Fixed-size sliding window frame.',
	lag: 'Value of a column N rows before the current row.',
	lead: 'Value of a column N rows after the current row.',
	first: 'First value of a column within the current group/window.',
	last: 'Last value of a column within the current group/window.',
	rank: 'Rank of the current row within its window, with gaps for ties.',
	rank_dense: 'Rank of the current row within its window, without gaps for ties.',
	row_number: 'Sequential row number within the current window.',
	round: 'Round a number to N decimal places.',
	abs: 'Absolute value.',
	floor: 'Round down to the nearest integer.',
	ceil: 'Round up to the nearest integer.',
	pi: 'The constant π.',
	lower: 'Convert text to lowercase.',
	upper: 'Convert text to uppercase.',
	ltrim: 'Remove leading whitespace.',
	rtrim: 'Remove trailing whitespace.',
	trim: 'Remove leading and trailing whitespace.',
	length: 'Length of a string or array.',
	extract: 'Extract a part of a date/timestamp (e.g. year, month, day).',
	contains: 'True if a string contains a substring.',
	starts_with: 'True if a string starts with a prefix.',
	ends_with: 'True if a string ends with a suffix.',
	coalesce: 'First non-null value among the arguments.',
	as: 'Cast a value to another type, e.g. `x | as int`.',
	date: 'Date type / date literal constructor.'
};

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
