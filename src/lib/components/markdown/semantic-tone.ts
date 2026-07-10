/** Shared 5-tone semantic accent → theme token mapping used by dashboard widgets
 * (badge, metric icon/value accents). Single source so the palette stays strictly
 * the theme's semantic set. */
export type SemanticTone = 'info' | 'success' | 'warning' | 'error' | 'neutral';

export function resolveSemanticToken(tone: SemanticTone | undefined, fallback: string): string {
	switch (tone) {
		case 'info':
			return 'var(--chart-1)';
		case 'success':
			return 'var(--success)';
		case 'warning':
			return 'var(--warning)';
		case 'error':
			return 'var(--destructive)';
		case 'neutral':
			return 'var(--foreground)';
		default:
			return fallback;
	}
}
