import {
	Hash,
	Type,
	ToggleLeft,
	Calendar,
	Clock,
	AtSign,
	Link2,
	KeyRound,
	Tag,
	Percent,
	DollarSign
} from '@lucide/svelte';
import type { ColumnFormatKind } from '$lib/services/column-format';

export const KIND_ICON: Record<ColumnFormatKind, typeof Hash> = {
	boolean: ToggleLeft,
	id: KeyRound,
	email: AtSign,
	url: Link2,
	datetime: Clock,
	date: Calendar,
	percentage: Percent,
	currency: DollarSign,
	number: Hash,
	category: Tag,
	text: Type
};

/** Kind → categorical tag token. Uses the semantic tint ladder (surface /10)
 *  with flat tag-colored text, matching the --tag-* palette's intended use. */
const KIND_BADGE: Record<ColumnFormatKind, string> = {
	boolean: 'bg-tag-4/10 text-tag-4',
	id: 'bg-tag-8/10 text-tag-8',
	email: 'bg-tag-5/10 text-tag-5',
	url: 'bg-tag-6/10 text-tag-6',
	datetime: 'bg-tag-3/10 text-tag-3',
	date: 'bg-tag-3/10 text-tag-3',
	percentage: 'bg-tag-2/10 text-tag-2',
	currency: 'bg-tag-2/10 text-tag-2',
	number: 'bg-tag-1/10 text-tag-1',
	category: 'bg-tag-7/10 text-tag-7',
	text: 'bg-tag-8/10 text-tag-8'
};

export function kindBadgeClass(kind: ColumnFormatKind): string {
	return KIND_BADGE[kind] ?? 'bg-muted text-muted-foreground';
}

export function fmtStatNum(value: number | null | undefined, digits = 2): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return '—';
	if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + 'M';
	if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + 'K';
	return value.toLocaleString(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits: digits
	});
}

export function fmtPct(value: number, digits = 1): string {
	return `${value.toFixed(digits)}%`;
}

/** List selection — same pairing as dropdown-menu / inline-chip-label. */
export const STATS_ITEM_SELECTED = 'bg-accent text-accent-foreground';
export const STATS_ITEM_IDLE = 'text-muted-foreground hover:bg-muted/50 hover:text-foreground';

/** Low-chroma data bars (chart-4 is muted in both themes; never use secondary as fill). */
export const STATS_BAR_PRIMARY = 'bg-chart-4/80';
export const STATS_BAR_SECONDARY = 'bg-muted-foreground/25';
export const STATS_HISTOGRAM = 'text-chart-4/75';
export const STATS_TOP_VALUE = 'bg-chart-4/35';
export const STATS_BOX_PLOT = 'text-chart-4/70';
