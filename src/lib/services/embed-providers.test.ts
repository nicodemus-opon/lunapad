import { describe, expect, it } from 'vitest';
import { embedUrlToIframeSrc, isEmbeddableUrl } from './embed-providers';

describe('embed-providers', () => {
	it('resolves a youtube watch URL to a youtube-nocookie embed', () => {
		expect(embedUrlToIframeSrc('https://www.youtube.com/watch?v=abc123')).toBe(
			'https://www.youtube-nocookie.com/embed/abc123'
		);
	});

	it('resolves a youtu.be short URL', () => {
		expect(embedUrlToIframeSrc('https://youtu.be/abc123')).toBe(
			'https://www.youtube-nocookie.com/embed/abc123'
		);
	});

	it('resolves a vimeo URL', () => {
		expect(embedUrlToIframeSrc('https://vimeo.com/123456')).toBe(
			'https://player.vimeo.com/video/123456'
		);
	});

	it('resolves a loom share URL', () => {
		expect(embedUrlToIframeSrc('https://www.loom.com/share/abcDEF123')).toBe(
			'https://www.loom.com/embed/abcDEF123'
		);
	});

	it('returns null for a non-allowlisted host', () => {
		expect(embedUrlToIframeSrc('https://attacker.example/evil')).toBeNull();
		expect(isEmbeddableUrl('https://attacker.example/evil')).toBe(false);
	});

	it('returns null for a javascript: URL', () => {
		expect(embedUrlToIframeSrc('javascript:alert(1)')).toBeNull();
	});

	it('returns null for a malformed URL', () => {
		expect(embedUrlToIframeSrc('not a url')).toBeNull();
	});
});
