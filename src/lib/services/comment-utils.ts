export function commentInitials(name: string | null | undefined, email?: string | null): string {
	const source = (name?.trim() || email?.split('@')[0] || '?').trim();
	const parts = source.split(/\s+/).filter(Boolean);
	if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
	return source.slice(0, 2).toUpperCase();
}

export function formatCommentTime(iso: string): string {
	const date = new Date(iso);
	const diff = Date.now() - date.getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function reasonLabel(reason: string): string {
	switch (reason) {
		case 'assigned':
			return 'Assigned';
		case 'mention':
			return 'Mentioned';
		case 'share_review':
			return 'Report';
		default:
			return 'Open';
	}
}
