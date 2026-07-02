import net from 'node:net';

function isPrivateIp(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	const family = net.isIP(host);
	if (family === 4) {
		const parts = host.split('.').map((p) => Number(p));
		const [a, b] = parts;
		return (
			a === 10 ||
			a === 127 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254) ||
			a === 0
		);
	}
	if (family === 6) {
		return (
			host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')
		);
	}
	return false;
}

function isLocalHostname(hostname: string): boolean {
	const h = hostname.toLowerCase().replace(/\.$/, '');
	return h === 'localhost' || h.endsWith('.localhost') || h === 'local' || h.endsWith('.local');
}

export function assertSafeOutboundHttpUrl(
	raw: string,
	options: { allowLocalhostInDev?: boolean } = {}
): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Invalid URL.');
	}

	if (url.username || url.password) throw new Error('URL credentials are not allowed.');

	const allowLocalhost =
		options.allowLocalhostInDev === true &&
		process.env.NODE_ENV !== 'production' &&
		(process.env.ALLOW_LOCAL_OUTBOUND_URLS === '1' || process.env.NODE_ENV !== 'production');

	if (url.protocol === 'http:') {
		if (!allowLocalhost || (!isLocalHostname(url.hostname) && !isPrivateIp(url.hostname))) {
			throw new Error('Only HTTPS outbound URLs are allowed.');
		}
	} else if (url.protocol !== 'https:') {
		throw new Error('Only HTTP(S) outbound URLs are allowed.');
	}

	if (!allowLocalhost && (isLocalHostname(url.hostname) || isPrivateIp(url.hostname))) {
		throw new Error('Outbound URLs cannot target localhost or private network addresses.');
	}

	return url;
}

export function normalizeSafeLlmBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	const url = assertSafeOutboundHttpUrl(trimmed, { allowLocalhostInDev: true });
	const normalized = url.toString().replace(/\/+$/, '');
	if (/\/v\d+$/i.test(normalized)) return normalized;
	return `${normalized}/v1`;
}
