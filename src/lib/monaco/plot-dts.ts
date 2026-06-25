// Observable Plot ships no single bundled `dist/*.d.ts` — its `types` field
// points at `src/index.d.ts`, a barrel of `export * from "./...")` re-exports
// across ~60 small, richly JSDoc-commented declaration files. Rather than
// hand-maintain a partial shim, glob all of them in at build time and register
// each under a virtual path that mirrors the package's real `src/` layout, so
// their relative `./marks/dot.js`-style imports resolve against each other
// exactly like the real package (TypeScript's resolver maps a `.js` import
// specifier to a co-located `.d.ts` file, which is how this package ships
// types for an ESM-only, no-build library in the first place).
const dtsModules = import.meta.glob('/node_modules/@observablehq/plot/src/**/*.d.ts', {
	eager: true,
	query: '?raw',
	import: 'default'
}) as Record<string, string>;

// One additional virtual file, co-located with the real tree (so its relative
// `./index.js` import resolves the same way), declaring `Plot` as a true
// global typed against the package's full real export surface — this is what
// makes `Plot.dot(...)` etc. autocomplete with genuine hover docs/signatures
// in a sandbox where `Plot` is passed in as a function argument, not imported.
const PLOT_GLOBAL_PATH = '/node_modules/@observablehq/plot/src/__lunapad_plot_global__.d.ts';
const PLOT_GLOBAL_DTS = `import * as PlotNS from "./index.js";\ndeclare global {\n  const Plot: typeof PlotNS;\n}\nexport {};\n`;

export interface ExtraLib {
	filePath: string;
	content: string;
}

let cached: ExtraLib[] | null = null;

/** Returns the full set of Observable Plot `.d.ts` files (plus the synthetic
 *  global-`Plot` shim) to register once, globally, via
 *  `javascriptDefaults.addExtraLib` — see plot-intellisense.ts. */
export function getPlotExtraLibs(): ExtraLib[] {
	if (cached) return cached;
	const libs: ExtraLib[] = Object.entries(dtsModules).map(([filePath, content]) => ({
		filePath: `file://${filePath}`,
		content
	}));
	libs.push({ filePath: `file://${PLOT_GLOBAL_PATH}`, content: PLOT_GLOBAL_DTS });
	cached = libs;
	return libs;
}
