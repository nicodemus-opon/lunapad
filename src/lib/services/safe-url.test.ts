import { describe, expect, it } from 'vitest';
import { sanitizeUrl, isSafeUrl } from './safe-url';

describe('sanitizeUrl', () => {
	it('allows safe absolute schemes', () => {
		expect(sanitizeUrl('https://example.com/x?y=1#z')).toBe('https://example.com/x?y=1#z');
		expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
		expect(sanitizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
		expect(sanitizeUrl('tel:+123')).toBe('tel:+123');
		expect(sanitizeUrl('ftp://host/file')).toBe('ftp://host/file');
	});

	it('allows relative, root-relative, anchor, and protocol-relative URLs', () => {
		expect(sanitizeUrl('/path/to/page')).toBe('/path/to/page');
		expect(sanitizeUrl('page.html')).toBe('page.html');
		expect(sanitizeUrl('#section')).toBe('#section');
		expect(sanitizeUrl('//cdn.example.com/a.js')).toBe('//cdn.example.com/a.js');
		expect(sanitizeUrl('/a/b:c')).toBe('/a/b:c');
	});

	it('blocks dangerous schemes', () => {
		expect(sanitizeUrl('javascript:alert(1)')).toBe('');
		expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
		expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('');
		expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe('');
	});

	it('blocks obfuscated schemes with embedded control/whitespace chars', () => {
		expect(sanitizeUrl('java\tscript:alert(1)')).toBe('');
		expect(sanitizeUrl('java\nscript:alert(1)')).toBe('');
		expect(sanitizeUrl('\u0001javascript:alert(1)')).toBe('');
		expect(sanitizeUrl('  javascript:alert(1)  ')).toBe('');
	});

	it('handles nullish and empty input', () => {
		expect(sanitizeUrl(null)).toBe('');
		expect(sanitizeUrl(undefined)).toBe('');
		expect(sanitizeUrl('')).toBe('');
		expect(sanitizeUrl('   ')).toBe('');
	});

	it('isSafeUrl mirrors sanitizeUrl', () => {
		expect(isSafeUrl('https://x.com')).toBe(true);
		expect(isSafeUrl('javascript:alert(1)')).toBe(false);
	});
});
