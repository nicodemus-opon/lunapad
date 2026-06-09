import fs from 'node:fs/promises';
import path from 'node:path';

// ── Page listing ──────────────────────────────────────────────────────────────

/** Recursively list all .md files under pages/ relative to folder. */
export async function listEvidencePages(folder: string): Promise<string[]> {
	const pagesDir = path.join(folder, 'pages');
	const results: string[] = [];

	async function walk(dir: string): Promise<void> {
		let names: string[];
		try {
			names = await fs.readdir(dir);
		} catch {
			return;
		}
		for (const name of names) {
			const full = path.join(dir, name);
			let stat: Awaited<ReturnType<typeof fs.stat>>;
			try {
				stat = await fs.stat(full);
			} catch {
				continue;
			}
			if (stat.isDirectory()) {
				await walk(full);
			} else if (stat.isFile() && name.endsWith('.md')) {
				results.push(path.relative(folder, full));
			}
		}
	}

	await walk(pagesDir);
	return results.sort();
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface EvidenceConfig {
	port: number;
}

/** Read Evidence port from package.json scripts or evidence.config.yaml (default 3000). */
export async function getEvidenceConfig(folder: string): Promise<EvidenceConfig> {
	// Try reading package.json dev script for a port override (e.g. --port 3001)
	try {
		const pkgRaw = await fs.readFile(path.join(folder, 'package.json'), 'utf-8');
		const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
		const devScript = pkg.scripts?.dev ?? '';
		const m = devScript.match(/--port[=\s]+(\d+)/);
		if (m) return { port: parseInt(m[1], 10) };
	} catch {
		// ignore
	}
	return { port: 3000 };
}

// ── Page I/O ──────────────────────────────────────────────────────────────────

export async function readEvidencePage(folder: string, pagePath: string): Promise<string> {
	return fs.readFile(path.join(folder, pagePath), 'utf-8');
}

export async function writeEvidencePage(
	folder: string,
	pagePath: string,
	content: string
): Promise<void> {
	const fullPath = path.join(folder, pagePath);
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, content, 'utf-8');
}
