#!/usr/bin/env node
/**
 * Tauri sidecar shim: starts the SvelteKit Node server on a random free port
 * and writes "PORT:{n}\n" to stdout so the Tauri process knows where to connect.
 */

'use strict';

const { createServer } = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

// Resolve the build directory relative to this shim (works both dev and bundled)
const buildDir = path.join(__dirname, '..', 'build');

function getFreePort() {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

async function main() {
	const port = await getFreePort();

	process.env.PORT = String(port);
	process.env.HOST = '127.0.0.1';

	// Signal Tauri before the server starts its own logging
	process.stdout.write(`PORT:${port}\n`);

	// adapter-node output is ESM with top-level await — must use dynamic import
	await import(pathToFileURL(path.join(buildDir, 'index.js')).href);
}

process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
	process.stderr.write(`server-shim error: ${err}\n`);
	process.exit(1);
});
