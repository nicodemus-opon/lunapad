// @types/plotly.js ships as ~52 small files (an index.d.ts barrel + a `lib/`
// directory of per-trace-type declarations, e.g. lib/bar.d.ts, lib/box.d.ts)
// with relative `./lib/box`-style imports between them. Glob them all in at
// build time and register each under a virtual path that mirrors the real
// package's layout, so those relative imports resolve against each other
// exactly like the real package — same trick the old Observable Plot dts
// loader used, just a much smaller file set.
const dtsModules = import.meta.glob(
	['/node_modules/@types/plotly.js/index.d.ts', '/node_modules/@types/plotly.js/lib/**/*.d.ts'],
	{ eager: true, query: '?raw', import: 'default' }
) as Record<string, string>;

// One additional virtual file, co-located with the real tree (so its relative
// `./index.js` import resolves the same way), declaring loose ambient aliases
// for the sandbox's POJO return shape. Plot cells/custom-chart code returns a
// plain `{ data: [...], layout: {...} }` literal — there's no builder global
// to type (unlike Observable Plot's `Plot.dot(...)` API), so these aliases
// only matter if a user explicitly JSDoc-annotates their literal
// (`/** @type {{data: PlotlyData[], layout: PlotlyLayout}} */`) for full
// property/value completion; unannotated code still passes with zero
// diagnostics (checkJs stays off, see plotly-intellisense.ts).
const PLOTLY_GLOBALS_PATH = '/node_modules/@types/plotly.js/__lunapad_plotly_globals__.d.ts';
const PLOTLY_GLOBALS_DTS = `import type { Data, Layout, Config } from "./index.js";
declare global {
  type PlotlyData = Data;
  type PlotlyLayout = Partial<Layout>;
  type PlotlyConfig = Partial<Config>;
}
export {};
`;

export interface ExtraLib {
	filePath: string;
	content: string;
}

let cached: ExtraLib[] | null = null;

/** Returns the full set of `@types/plotly.js` `.d.ts` files (plus the
 *  synthetic globals shim) to register once, globally, via
 *  `javascriptDefaults.addExtraLib` — see plotly-intellisense.ts. */
export function getPlotlyExtraLibs(): ExtraLib[] {
	if (cached) return cached;
	const libs: ExtraLib[] = Object.entries(dtsModules).map(([filePath, content]) => ({
		filePath: `file://${filePath}`,
		content
	}));
	libs.push({ filePath: `file://${PLOTLY_GLOBALS_PATH}`, content: PLOTLY_GLOBALS_DTS });
	cached = libs;
	return libs;
}
