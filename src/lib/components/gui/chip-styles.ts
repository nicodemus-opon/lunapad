/**
 * Unified chip recipe for GUI pipeline stage chips.
 *
 * `stage-chip` is a styling marker targeted by PipelineStageCard's err-chips
 * selector (it tints every `.stage-chip:not(.border-dashed)` inside an errored
 * stage), so value chips must include it and dashed add-affordances must not
 * carry a solid border.
 *
 * Keep these as plain string literals — Tailwind v4 scans this file for class
 * names and cannot see concatenated strings.
 */

/** Value chip container (collapsed pills). Pair with role="listitem" + drag handlers. */
export const CHIP =
	'stage-chip group/pill inline-flex h-6 shrink-0 items-center overflow-hidden rounded border border-border bg-background font-mono text-xs transition-colors duration-(--motion-fast)';

/** Appended to CHIP when the referenced column is invalid. */
export const CHIP_INVALID = 'border-destructive bg-destructive/10 text-destructive';

/** Expanded inline edit form. */
export const CHIP_EDITING =
	'stage-chip inline-flex shrink-0 items-center gap-1 rounded border border-ring bg-background px-1.5 py-0.5 ring-2 ring-ring/15';

/** Clickable segment inside a chip (the main label button). */
export const CHIP_SECTION =
	'inline-flex h-full items-center px-2 transition-colors duration-(--motion-fast) hover:bg-muted/60';

/** Hover-revealed remove (X) button inside a chip. */
export const CHIP_X =
	'inline-flex h-full items-center px-1.5 text-muted-foreground/60 opacity-0 transition-[opacity,color] duration-(--motion-fast) group-hover/pill:opacity-100 hover:text-destructive';

/** "+ add" affordance (dashed, monochrome). */
export const CHIP_ADD =
	'inline-flex h-6 shrink-0 items-center gap-1 rounded border border-dashed border-border px-2 font-mono text-xs text-muted-foreground/70 transition-colors duration-(--motion-fast) hover:border-muted-foreground hover:bg-muted/30 hover:text-foreground';

/** Inert connector glyphs inside chips: = == ( ) . etc. */
export const CHIP_META = 'select-none text-2xs text-muted-foreground/50';

/** Native <select> embedded in a chip (kept native for e2e; restyled). */
export const CHIP_SELECT =
	'h-full cursor-pointer bg-transparent px-1 font-mono text-xs text-muted-foreground outline-none transition-colors duration-(--motion-fast) hover:text-foreground';

/** Tiny mode/section labels: "agg", "by", "evidence", "next". */
export const SECTION_LABEL = 'select-none font-mono text-2xs lowercase text-muted-foreground/50';
