import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Vercel sets VERCEL=1 at build time, where adapter-auto picks the Vercel adapter.
		// Everywhere else (Docker, plain `pnpm build`) adapter-auto detects nothing and
		// emits NO server output, so fall back to adapter-node explicitly.
		adapter: process.env.VERCEL ? adapterAuto() : adapterNode()
	}
};

export default config;
