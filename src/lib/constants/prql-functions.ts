import type { ExprFunc } from '$lib/types/gui-pipeline';

export type PrqlFunctionCategory = 'common' | 'math' | 'text' | 'date';

export interface PrqlFunctionArgSpec {
	label: string;
	placeholder: string;
	defaultKind: 'column' | 'literal';
	defaultValue?: string;
}

export interface PrqlFunctionOption {
	value: ExprFunc;
	label: string;
	category: PrqlFunctionCategory;
	detail: string;
	args: PrqlFunctionArgSpec[];
	keywords: string[];
}

export const PRQL_FUNCTION_REGISTRY: PrqlFunctionOption[] = [
	{
		value: 'coalesce',
		label: 'coalesce()',
		category: 'common',
		detail: 'Fallback through arguments until a non-null value is found.',
		args: [
			{ label: 'Value', placeholder: 'column or value...', defaultKind: 'column' },
			{ label: 'Fallback', placeholder: '0', defaultKind: 'literal', defaultValue: '0' }
		],
		keywords: ['null', 'fallback', 'default']
	},
	{
		value: 'math.abs',
		label: 'abs()',
		category: 'math',
		detail: 'Absolute value of a numeric expression.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['absolute', 'magnitude']
	},
	{
		value: 'math.acos',
		label: 'acos()',
		category: 'math',
		detail: 'Inverse cosine of a value.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['inverse', 'cosine', 'trig']
	},
	{
		value: 'math.asin',
		label: 'asin()',
		category: 'math',
		detail: 'Inverse sine of a value.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['inverse', 'sine', 'trig']
	},
	{
		value: 'math.atan',
		label: 'atan()',
		category: 'math',
		detail: 'Inverse tangent of a value.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['inverse', 'tangent', 'trig']
	},
	{
		value: 'math.ceil',
		label: 'ceil()',
		category: 'math',
		detail: 'Round a numeric value up.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['round', 'up']
	},
	{
		value: 'math.cos',
		label: 'cos()',
		category: 'math',
		detail: 'Cosine of an angle.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['cosine', 'trig']
	},
	{
		value: 'math.degrees',
		label: 'degrees()',
		category: 'math',
		detail: 'Convert radians to degrees.',
		args: [{ label: 'Radians', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['convert', 'radians']
	},
	{
		value: 'math.exp',
		label: 'exp()',
		category: 'math',
		detail: 'Exponential of a value.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['exponential', 'power', 'e']
	},
	{
		value: 'math.floor',
		label: 'floor()',
		category: 'math',
		detail: 'Round a numeric value down.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['round', 'down']
	},
	{
		value: 'math.ln',
		label: 'ln()',
		category: 'math',
		detail: 'Natural logarithm of a value.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['log', 'natural']
	},
	{
		value: 'math.log',
		label: 'log()',
		category: 'math',
		detail: 'Logarithm of a value using a chosen base.',
		args: [
			{ label: 'Base', placeholder: '10', defaultKind: 'literal', defaultValue: '10' },
			{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['log', 'base']
	},
	{
		value: 'math.log10',
		label: 'log10()',
		category: 'math',
		detail: 'Base-10 logarithm of a value.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['log', 'base 10']
	},
	{
		value: 'math.pi',
		label: 'pi()',
		category: 'math',
		detail: 'Insert the constant pi directly.',
		args: [],
		keywords: ['constant', 'pi']
	},
	{
		value: 'math.pow',
		label: 'pow()',
		category: 'math',
		detail: 'Raise a value to an exponent.',
		args: [
			{ label: 'Exponent', placeholder: '2', defaultKind: 'literal', defaultValue: '2' },
			{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['power', 'exponent']
	},
	{
		value: 'math.radians',
		label: 'radians()',
		category: 'math',
		detail: 'Convert degrees to radians.',
		args: [{ label: 'Degrees', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['convert', 'degrees']
	},
	{
		value: 'math.round',
		label: 'round()',
		category: 'math',
		detail: 'Round a value to a chosen number of decimals.',
		args: [
			{ label: 'Digits', placeholder: '0', defaultKind: 'literal', defaultValue: '0' },
			{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['round', 'digits', 'decimal']
	},
	{
		value: 'math.sin',
		label: 'sin()',
		category: 'math',
		detail: 'Sine of an angle.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['sine', 'trig']
	},
	{
		value: 'math.sqrt',
		label: 'sqrt()',
		category: 'math',
		detail: 'Square root of a value.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['root']
	},
	{
		value: 'math.tan',
		label: 'tan()',
		category: 'math',
		detail: 'Tangent of an angle.',
		args: [{ label: 'Value', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['tangent', 'trig']
	},
	{
		value: 'text.contains',
		label: 'contains()',
		category: 'text',
		detail: 'Check whether text contains a substring.',
		args: [
			{ label: 'Substring', placeholder: 'needle', defaultKind: 'literal', defaultValue: '' },
			{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['text', 'substring', 'search']
	},
	{
		value: 'text.ends_with',
		label: 'ends_with()',
		category: 'text',
		detail: 'Check whether text ends with a suffix.',
		args: [
			{ label: 'Suffix', placeholder: 'suffix', defaultKind: 'literal', defaultValue: '' },
			{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['text', 'suffix']
	},
	{
		value: 'text.extract',
		label: 'extract()',
		category: 'text',
		detail: 'Extract a substring by start index and length.',
		args: [
			{ label: 'Index', placeholder: '1', defaultKind: 'literal', defaultValue: '1' },
			{ label: 'Length', placeholder: '3', defaultKind: 'literal', defaultValue: '3' },
			{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['text', 'substring']
	},
	{
		value: 'text.length',
		label: 'length()',
		category: 'text',
		detail: 'Count the number of characters in text.',
		args: [{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['text', 'count', 'chars']
	},
	{
		value: 'text.lower',
		label: 'lower()',
		category: 'text',
		detail: 'Convert text to lowercase.',
		args: [{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['text', 'lowercase', 'normalize']
	},
	{
		value: 'text.ltrim',
		label: 'ltrim()',
		category: 'text',
		detail: 'Trim whitespace on the left side.',
		args: [{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['text', 'trim']
	},
	{
		value: 'text.replace',
		label: 'replace()',
		category: 'text',
		detail: 'Replace all matching text with a new value.',
		args: [
			{ label: 'Find', placeholder: 'old text', defaultKind: 'literal', defaultValue: '' },
			{ label: 'Replace with', placeholder: 'new text', defaultKind: 'literal', defaultValue: '' },
			{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['text', 'replace', 'clean']
	},
	{
		value: 'text.rtrim',
		label: 'rtrim()',
		category: 'text',
		detail: 'Trim whitespace on the right side.',
		args: [{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['text', 'trim']
	},
	{
		value: 'text.starts_with',
		label: 'starts_with()',
		category: 'text',
		detail: 'Check whether text starts with a prefix.',
		args: [
			{ label: 'Prefix', placeholder: 'prefix', defaultKind: 'literal', defaultValue: '' },
			{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['text', 'prefix']
	},
	{
		value: 'text.trim',
		label: 'trim()',
		category: 'text',
		detail: 'Trim whitespace on both ends.',
		args: [{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['text', 'trim']
	},
	{
		value: 'text.upper',
		label: 'upper()',
		category: 'text',
		detail: 'Convert text to uppercase.',
		args: [{ label: 'Text', placeholder: 'column...', defaultKind: 'column' }],
		keywords: ['text', 'uppercase', 'normalize']
	},
	{
		value: 'date.now',
		label: 'now()',
		category: 'date',
		detail: 'Insert the current timestamp.',
		args: [],
		keywords: ['date', 'time', 'current', 'now']
	},
	{
		value: 'date.to_text',
		label: 'to_text()',
		category: 'date',
		detail: 'Format a date or timestamp with an explicit pattern.',
		args: [
			{
				label: 'Format',
				placeholder: '%Y-%m-%d',
				defaultKind: 'literal',
				defaultValue: '%Y-%m-%d'
			},
			{ label: 'Date value', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['date', 'format', 'string']
	},
	{
		value: 'date.diff',
		label: 'diff()',
		category: 'date',
		detail: 'Measure the difference between two dates in a chosen unit.',
		args: [
			{ label: 'Unit', placeholder: 'days', defaultKind: 'literal', defaultValue: 'days' },
			{ label: 'Start', placeholder: 'column...', defaultKind: 'column' },
			{ label: 'End', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['date', 'diff', 'duration', 'elapsed']
	},
	{
		value: 'date.trunc',
		label: 'trunc()',
		category: 'date',
		detail: 'Truncate a date or timestamp to a chosen unit.',
		args: [
			{ label: 'Unit', placeholder: 'day', defaultKind: 'literal', defaultValue: 'day' },
			{ label: 'Date value', placeholder: 'column...', defaultKind: 'column' }
		],
		keywords: ['date', 'truncate', 'bucket', 'period']
	}
];

export const LEGACY_PRQL_FUNCTION_ALIASES: Partial<Record<ExprFunc, ExprFunc>> = {
	round: 'math.round',
	floor: 'math.floor',
	ceil: 'math.ceil',
	abs: 'math.abs',
	lower: 'text.lower',
	upper: 'text.upper',
	length: 'text.length',
	trim: 'text.trim'
};

export function canonicalizePrqlFunction(func: ExprFunc): ExprFunc {
	return LEGACY_PRQL_FUNCTION_ALIASES[func] ?? func;
}

export function getPrqlFunctionOption(func: ExprFunc): PrqlFunctionOption {
	return (
		PRQL_FUNCTION_REGISTRY.find((option) => option.value === canonicalizePrqlFunction(func)) ??
		PRQL_FUNCTION_REGISTRY[0]
	);
}

export function getPrqlFunctionArity(func: ExprFunc): { minArgs: number; maxArgs: number } {
	const option = getPrqlFunctionOption(func);
	const argCount = option.args.length;
	if (option.value === 'coalesce') {
		return { minArgs: 2, maxArgs: Number.POSITIVE_INFINITY };
	}
	return { minArgs: argCount, maxArgs: argCount };
}
