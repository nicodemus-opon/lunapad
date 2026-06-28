// plotly.js-dist-min ships no types of its own — it's the same API surface as
// plotly.js (just pre-bundled/minified), so re-export @types/plotly.js's
// declarations under this module's name instead of duplicating them.
declare module 'plotly.js-dist-min' {
	export * from 'plotly.js';
}
