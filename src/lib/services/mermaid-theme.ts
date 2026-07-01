import {
	compensateMermaidCScale,
	resolveCSSColor,
	resolveCSSFontFamily,
	resolveCSSLengthPx,
	resolveChartColorway
} from '$lib/utils/theme-colors';

/** Mermaid kanban hard-codes priority stripe colors (red/orange/blue/lightblue). */
const KANBAN_PRIORITY_STROKES: Record<string, string> = {
	red: '--destructive',
	orange: '--warning',
	blue: '--primary',
	lightblue: '--tag-4'
};

/**
 * Injected at the end of every rendered SVG. Uses live CSS custom properties so
 * diagrams track light/dark theme without re-parsing Mermaid's embedded rgb()
 * styles (kanban/mindmap bake cScale colors into an internal &lt;style&gt; tag).
 */
const MERMAID_SVG_THEME_STYLE = `<style id="lunapad-mermaid-theme">
  /* Nodes & cards — elevated surface */
  .node rect, .node circle, .node ellipse, .node polygon, .node path,
  .basic.label-container,
  .kanban-ticket-link,
  .actor, .er.entityBox,
  .state rect, .statediagram-state rect,
  .task rect, .taskTextOutsideRight, .taskTextOutsideLeft {
    fill: var(--popover) !important;
    stroke: var(--border) !important;
  }

  /* Corner radius — matches --radius (overrides Mermaid's baked rx/ry) */
  .node rect, .basic.label-container,
  .kanban-ticket-link,
  .actor rect, .er.entityBox,
  .state rect, .statediagram-state rect,
  .task rect, .note rect,
  .edgeLabel rect,
  [class*="section-"] rect,
  .cluster rect, .state-group rect {
    rx: var(--radius) !important;
    ry: var(--radius) !important;
  }

  /* Column / cluster / subgraph backgrounds */
  [class*="section-"] rect,
  [class*="section-"] path,
  [class*="section-"] circle,
  [class*="section-"] polygon,
  .section-root rect,
  .section-root path,
  .cluster rect,
  .state-group rect {
    fill: var(--muted) !important;
    stroke: var(--border) !important;
  }

  /* Labels & text */
  text, .label, .nodeLabel, .cluster-label,
  .kanban-label, .taskText, .loopText, .messageText,
  .actor tspan, .titleText, .pieTitleText,
  .pieLegend text, .commit-label, .branch-label,
  .er .entityLabel, .er .attributeLabel,
  [class*="section-"] text, .section-root text {
    fill: var(--foreground) !important;
    color: var(--foreground) !important;
    font-family: var(--font-sans) !important;
  }

  .node-icon text, .node-icon tspan {
    fill: var(--foreground) !important;
  }

  /* Edges & connectors */
  .edgePath .path, .flowchart-link, .edge-thickness-normal,
  .messageLine0, .messageLine1,
  .transition, line.messageLine0, line.messageLine1,
  .edge, [class*="section-edge-"] {
    stroke: var(--muted-foreground) !important;
  }
  .arrowheadPath, marker path {
    fill: var(--muted-foreground) !important;
    stroke: var(--muted-foreground) !important;
  }

  /* ER attribute rows */
  .er.attributeBoxOdd { fill: var(--popover) !important; }
  .er.attributeBoxEven { fill: var(--muted) !important; }

  /* Gantt grid */
  .grid .tick line, .grid path { stroke: var(--border) !important; }

  /* Pie — keep slice fills from theme vars; fix strokes & labels only */
  .pieCircle, .pieOuterCircle {
    stroke: var(--border) !important;
  }

  /* Notes & activation (sequence) */
  .note rect, .activation0, .activation1, .activation2 {
    fill: var(--muted) !important;
    stroke: var(--border) !important;
  }

  /* Edge label boxes */
  .edgeLabel rect {
    fill: var(--popover) !important;
    stroke: var(--border) !important;
  }
</style>`;

/** Build Mermaid `themeVariables` from the app's OKLCH design tokens. */
export function buildMermaidThemeVars(darkMode: boolean): Record<string, string | boolean> {
	const foreground = resolveCSSColor('--foreground');
	const mutedForeground = resolveCSSColor('--muted-foreground');
	const border = resolveCSSColor('--border');
	const popover = resolveCSSColor('--popover');
	const muted = resolveCSSColor('--muted');
	const chartColors = resolveChartColorway();

	const cScale: Record<string, string> = {};
	const cScaleLabel: Record<string, string> = {};
	// Kanban/mindmap map section-N → cScale; Mermaid then darkens each index
	// again in dark mode. Pre-lighten so the baked-in SVG styles land near our
	// surfaces, and injectMermaidSvgTheme() enforces the final tokens.
	const sectionFill = compensateMermaidCScale(muted, darkMode);
	for (let i = 0; i < 12; i++) {
		cScale[`cScale${i}`] = sectionFill;
		cScaleLabel[`cScaleLabel${i}`] = foreground;
	}

	const pieVars: Record<string, string> = {};
	for (let i = 0; i < 12; i++) {
		pieVars[`pie${i + 1}`] = chartColors[i % chartColors.length];
	}

	const gitVars: Record<string, string> = {};
	for (let i = 0; i < 8; i++) {
		gitVars[`git${i}`] = chartColors[i % chartColors.length];
		gitVars[`gitBranchLabel${i}`] = foreground;
	}

	return {
		darkMode,
		useGradient: false,
		dropShadow: 'none',
		radius: String(resolveCSSLengthPx('--radius')),
		strokeWidth: '1',
		// Kanban item cards use `background` for fill — must be elevated, not page bg.
		background: popover,
		edgeLabelBackground: popover,
		primaryColor: popover,
		mainBkg: popover,
		actorBkg: popover,
		labelBoxBkgColor: popover,
		personBkg: popover,
		nodeBkg: popover,
		primaryTextColor: foreground,
		textColor: foreground,
		nodeTextColor: foreground,
		signalColor: foreground,
		signalTextColor: foreground,
		titleColor: foreground,
		labelTextColor: foreground,
		actorTextColor: foreground,
		noteTextColor: foreground,
		taskTextColor: foreground,
		taskTextDarkColor: foreground,
		taskTextLightColor: foreground,
		taskTextOutsideColor: foreground,
		scaleLabelColor: foreground,
		pieTitleTextColor: foreground,
		pieSectionTextColor: foreground,
		pieLegendTextColor: foreground,
		primaryBorderColor: border,
		nodeBorder: border,
		clusterBorder: border,
		actorBorder: border,
		personBorder: border,
		noteBorderColor: border,
		secondaryColor: muted,
		secondaryTextColor: foreground,
		secondaryBorderColor: border,
		tertiaryColor: muted,
		tertiaryTextColor: foreground,
		tertiaryBorderColor: border,
		clusterBkg: muted,
		noteBkgColor: muted,
		activationBkgColor: muted,
		taskBkgColor: popover,
		taskBorderColor: border,
		activeTaskBkgColor: popover,
		activeTaskBorderColor: border,
		doneTaskBkgColor: muted,
		doneTaskBorderColor: border,
		critBkgColor: resolveCSSColor('--destructive'),
		critBorderColor: resolveCSSColor('--destructive'),
		lineColor: mutedForeground,
		actorLineColor: mutedForeground,
		loopTextColor: foreground,
		activationBorderColor: border,
		gridColor: border,
		todayLineColor: resolveCSSColor('--primary'),
		pieStrokeColor: border,
		pieOuterStrokeColor: border,
		pieOpacity: '1',
		fontFamily:
			resolveCSSFontFamily('--font-sans') ||
			"'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
		fontSize: '13px',
		...cScale,
		...cScaleLabel,
		...pieVars,
		...gitVars
	};
}

/** Append theme overrides and rewrite hard-coded kanban priority strokes. */
export function themeMermaidSvg(svg: string): string {
	let out = svg;
	if (typeof document !== 'undefined') {
		for (const [mermaidColor, token] of Object.entries(KANBAN_PRIORITY_STROKES)) {
			const themed = resolveCSSColor(token);
			out = out.replaceAll(`stroke="${mermaidColor}"`, `stroke="${themed}"`);
		}
	}
	if (out.includes('</svg>')) {
		out = out.replace('</svg>', `${MERMAID_SVG_THEME_STYLE}</svg>`);
	}
	return out;
}
