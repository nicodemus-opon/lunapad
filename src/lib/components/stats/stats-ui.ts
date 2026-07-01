import {
	Hash,
	Type,
	ToggleLeft,
	Calendar,
	CalendarClock,
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
	datetime: CalendarClock,
	date: Calendar,
	percentage: Percent,
	currency: DollarSign,
	number: Hash,
	category: Tag,
	text: Type
};

export function kindBadgeClass(_kind: ColumnFormatKind): string {
	return 'bg-muted text-muted-foreground';
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
export const STATS_ITEM_IDLE =
	'text-muted-foreground hover:bg-muted/50 hover:text-foreground';

/** Low-chroma data bars (chart-4 is muted in both themes; never use secondary as fill). */
export const STATS_BAR_PRIMARY = 'bg-chart-4/80';
export const STATS_BAR_SECONDARY = 'bg-muted-foreground/25';
export const STATS_HISTOGRAM = 'text-chart-4/75';
export const STATS_TOP_VALUE = 'bg-chart-4/35';
export const STATS_BOX_PLOT = 'text-chart-4/70';
