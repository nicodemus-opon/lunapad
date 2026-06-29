import { describe, expect, it } from 'vitest';
import { formatDocstring } from './docstring-format';

describe('formatDocstring', () => {
	it('returns empty string for empty input', () => {
		expect(formatDocstring('')).toBe('');
		expect(formatDocstring('   \n  ')).toBe('');
	});

	it('joins a free-text paragraph onto one line', () => {
		const raw = 'Immutable sequence used for indexing\nand alignment.';
		expect(formatDocstring(raw)).toBe('Immutable sequence used for indexing and alignment.');
	});

	it('keeps separate paragraphs separated by blank lines', () => {
		const raw = 'First paragraph.\n\nSecond paragraph.';
		expect(formatDocstring(raw)).toBe('First paragraph.\n\nSecond paragraph.');
	});

	it('converts a numpydoc Parameters section into a markdown list', () => {
		const raw = [
			'Parameters',
			'----------',
			'data : array-like (1-dimensional)',
			'    An array-like structure containing the data for the index.',
			'dtype : str, optional',
			'    Data type for the output Index. If not specified, this will',
			'    be inferred from data.',
			'copy : bool, default None',
			'    Whether to copy input data.'
		].join('\n');

		const result = formatDocstring(raw);
		expect(result).toContain('#### Parameters');
		expect(result).toContain(
			'- **data** *array-like (1-dimensional)* — An array-like structure containing the data for the index.'
		);
		expect(result).toContain(
			'- **dtype** *str, optional* — Data type for the output Index. If not specified, this will be inferred from data.'
		);
		expect(result).toContain('- **copy** *bool, default None* — Whether to copy input data.');
	});

	it('leaves non-definition sections like Notes as plain paragraphs', () => {
		const raw = ['Notes', '-----', 'This is a free-form note', 'spanning two lines.'].join('\n');
		const result = formatDocstring(raw);
		expect(result).toContain('#### Notes');
		expect(result).toContain('This is a free-form note spanning two lines.');
		expect(result).not.toContain('- **');
	});

	it('strips RST :ref: roles down to their link text', () => {
		const raw = 'See the :ref:`user guide <basics.dtypes>` for more usages.';
		expect(formatDocstring(raw)).toBe('See the user guide for more usages.');
	});

	it('converts other RST domain roles to inline code', () => {
		const raw = 'Equivalent to :meth:`pandas.DataFrame.head`.';
		expect(formatDocstring(raw)).toBe('Equivalent to `head`.');
	});

	it('converts versionchanged directives to bold notes', () => {
		const raw = [
			'.. versionchanged:: 2.0.0',
			'',
			'    Index can now hold all numpy numeric dtypes.'
		].join('\n');
		const result = formatDocstring(raw);
		expect(result).toContain('**Changed in 2.0.0:**');
		expect(result).toContain('Index can now hold all numpy numeric dtypes.');
	});

	it('handles a full real-world-shaped docstring without throwing', () => {
		const raw = [
			'Immutable sequence used for indexing and alignment.',
			'',
			'The basic object storing axis labels for all pandas objects.',
			'',
			'Parameters',
			'----------',
			'data : array-like (1-dimensional)',
			'    An array-like structure containing the data for the index.',
			'',
			'Returns',
			'-------',
			'Index'
		].join('\n');

		const result = formatDocstring(raw);
		expect(result).toContain('Immutable sequence used for indexing and alignment.');
		expect(result).toContain('#### Parameters');
		expect(result).toContain('#### Returns');
		expect(result).toContain('- **Index**');
	});
});
