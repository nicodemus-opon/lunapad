/**
 * URL scheme allowlist for any href/src that originates from user-controlled data
 * (query result cells, Markdoc attributes, share exports, etc.).
 *
 * HTML-attribute escaping alone does NOT stop `javascript:`/`data:`/`vbscript:`
 * URLs: the value stays inside the attribute but the scheme still executes on
 * click/navigation. This normalizes the scheme (stripping the control/whitespace
 * obfuscation browsers ignore) and rejects anything outside a small safe set.
 *
 * Returns the original string when safe (relative URLs, fragments, and allowed
 * schemes), or '' when the URL must not be emitted.
 */
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);

export function sanitizeUrl(raw: unknown): string {
	const s = String(raw ?? '').trim();
	if (s === '') return '';

	const colon = s.indexOf(':');
	if (colon === -1) return s; // relative path, anchor, or query — no scheme

	const before = s.slice(0, colon);
	// A real scheme has no path/query/fragment separators before the ':'. If any
	// are present, the ':' belongs to a path/query (e.g. "/a/b:c"), so allow it.
	if (/[/?#]/.test(before)) return s;

	// Strip the control/whitespace characters browsers ignore inside a scheme
	// (e.g. "java\tscript:") so obfuscated payloads can't slip past the allowlist.
	const scheme = before.replace(/[\u0000-\u0020\u007f-\u009f]+/g, '').toLowerCase();
	return ALLOWED_SCHEMES.has(scheme) ? s : '';
}

/** True when the URL is safe to emit as an href/src. */
export function isSafeUrl(raw: unknown): boolean {
	return sanitizeUrl(raw) !== '';
}
