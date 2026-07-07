/**
 * Resolves a video page URL to a safe-to-embed iframe src, or null when the host isn't
 * allowlisted. Never construct an iframe src from an arbitrary URL directly — an unlisted
 * host renders as a link card instead (see BookmarkWidget / EmbedWidget).
 */
export function embedUrlToIframeSrc(rawUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

	const host = url.hostname.replace(/^www\./, '').toLowerCase();

	if (host === 'youtube.com' || host === 'm.youtube.com') {
		const id = url.searchParams.get('v');
		if (id) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
		const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/);
		if (shortsMatch)
			return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(shortsMatch[1])}`;
		return null;
	}
	if (host === 'youtu.be') {
		const id = url.pathname.slice(1);
		return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
	}
	if (host === 'vimeo.com') {
		const id = url.pathname.split('/').filter(Boolean)[0];
		return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
	}
	if (host === 'loom.com') {
		const match = url.pathname.match(/^\/share\/([a-zA-Z0-9]+)/);
		return match ? `https://www.loom.com/embed/${match[1]}` : null;
	}

	return null;
}

/** True when the URL's host is on the embeddable-iframe allowlist. */
export function isEmbeddableUrl(rawUrl: string): boolean {
	return embedUrlToIframeSrc(rawUrl) !== null;
}
