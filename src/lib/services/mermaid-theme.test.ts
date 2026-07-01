import { describe, expect, it } from 'vitest';
import { themeMermaidSvg } from './mermaid-theme';
import { compensateMermaidCScale, rgbLighten } from '$lib/utils/theme-colors';

describe('rgbLighten', () => {
	it('lightens rgb toward white', () => {
		expect(rgbLighten('rgb(0,0,0)', 50)).toBe('rgb(128,128,128)');
		expect(rgbLighten('rgb(100,100,100)', 0)).toBe('rgb(100,100,100)');
	});
});

describe('compensateMermaidCScale', () => {
	it('lightens more aggressively in dark mode', () => {
		const base = 'rgb(50,50,50)';
		expect(compensateMermaidCScale(base, true)).not.toBe(base);
		expect(compensateMermaidCScale(base, true)).not.toBe(compensateMermaidCScale(base, false));
	});
});

describe('themeMermaidSvg', () => {
	it('injects lunapad theme style block before closing svg tag', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';
		const themed = themeMermaidSvg(svg);
		expect(themed).toContain('id="lunapad-mermaid-theme"');
		expect(themed).toContain('var(--popover)');
		expect(themed).toContain('var(--foreground)');
		expect(themed).toContain('var(--radius)');
		expect(themed).toContain('var(--font-sans)');
		expect(themed.indexOf('lunapad-mermaid-theme')).toBeLessThan(themed.indexOf('</svg>'));
	});
});
