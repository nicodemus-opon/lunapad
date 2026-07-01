import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafe } from './project.js';

/**
 * Durable, per-project AI memory — decisions and discoveries recorded via the
 * `record_decision` tool, plus the freeform "custom instructions" blob, persisted
 * under the open dbt project folder (like `.lunapad/python-packages.json`) so they
 * survive across browsers/machines and are git-trackable, instead of living only in
 * a 24h-TTL localStorage cap (see `ai-chat-client.ts`'s old `AI_MEMORY_KEY`).
 *
 * Layout:
 *   .lunapad/memory/
 *     INDEX.md          — human-facing, regenerated on every write, never parsed back
 *     conventions.md    — raw freeform text (the customInstructions blob), no frontmatter
 *     <slug>.md         — one decision/discovery per file, frontmattered
 *
 * Each entry file is a single atomically-written, uniquely-named file, so concurrent
 * writes from two tabs never race on content — only INDEX.md's regeneration has a
 * narrow last-write-wins race, and it's self-healing since it's re-derived from the
 * directory listing (never treated as a source of truth by this module).
 */

export type MemoryEntryType = 'decision' | 'discovery';

export interface MemoryIndexEntry {
	slug: string;
	description: string;
	type: MemoryEntryType;
	date: string;
}

function memoryDir(folder: string): string {
	return path.join(folder, '.lunapad', 'memory');
}

function indexPath(folder: string): string {
	return path.join(memoryDir(folder), 'INDEX.md');
}

function conventionsPath(folder: string): string {
	return path.join(memoryDir(folder), 'conventions.md');
}

function entryPath(folder: string, slug: string): string {
	return path.join(memoryDir(folder), `${slug}.md`);
}

const STOPWORDS = new Set([
	'the',
	'a',
	'an',
	'and',
	'or',
	'of',
	'to',
	'in',
	'on',
	'for',
	'is',
	'are',
	'was',
	'were',
	'this',
	'that',
	'with',
	'as',
	'by',
	'it',
	'be',
	'has',
	'have',
	'not',
	'but'
]);

export function slugify(text: string): string {
	const base = text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 6)
		.join('-')
		.slice(0, 60)
		.replace(/-+$/, '');
	return base || 'entry';
}

async function uniqueSlug(folder: string, base: string): Promise<string> {
	const dir = memoryDir(folder);
	let candidate = base;
	let n = 2;
	// Bounded — a pathological run of collisions falls back to a timestamp suffix
	// rather than looping forever.
	for (let i = 0; i < 50; i++) {
		try {
			await fs.access(path.join(dir, `${candidate}.md`));
			candidate = `${base}-${n}`;
			n++;
		} catch {
			return candidate;
		}
	}
	return `${base}-${Date.now()}`;
}

// Entry text is always flattened to a single line before it's written anywhere
// (frontmatter value and body alike) — decisions/discoveries are short atomic
// facts by design, and this sidesteps markdown-injection entirely: there is no
// multi-line free text anywhere in an entry file for a naive frontmatter-block
// regex to misparse. (`conventions.md` is the one place multi-line free text is
// allowed — it's stored raw with no frontmatter and never parsed, only read back
// verbatim.)
function flatten(text: string): string {
	return text.replace(/\r?\n+/g, ' ').trim();
}

function renderEntry(input: {
	slug: string;
	type: MemoryEntryType;
	text: string;
	date: string;
}): string {
	const flat = flatten(input.text);
	const description = flat.slice(0, 300);
	return `---
name: ${input.slug}
description: ${description}
metadata:
  type: ${input.type}
  date: ${input.date}
---

${flat}
`;
}

interface ParsedFrontmatter {
	description?: string;
	type?: string;
	date?: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const block = match[1];
	const result: ParsedFrontmatter = {};
	const descMatch = block.match(/^description:\s*(.*)$/m);
	if (descMatch) result.description = descMatch[1].trim();
	const typeMatch = block.match(/^\s+type:\s*(.*)$/m);
	if (typeMatch) result.type = typeMatch[1].trim();
	const dateMatch = block.match(/^\s+date:\s*(.*)$/m);
	if (dateMatch) result.date = dateMatch[1].trim();
	return result;
}

/** Read-only directory scan — the real source of truth. Never writes anything,
 *  so it's safe to call on every chat turn without amplifying the INDEX.md race. */
async function listEntries(folder: string): Promise<MemoryIndexEntry[]> {
	const dir = memoryDir(folder);
	let files: string[] = [];
	try {
		files = (await fs.readdir(dir)).filter(
			(f) => f.endsWith('.md') && f !== 'INDEX.md' && f !== 'conventions.md'
		);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
			console.warn('[ai-memory] failed to list memory dir:', err);
		}
		return [];
	}

	const entries: MemoryIndexEntry[] = [];
	for (const file of files) {
		try {
			const raw = await fs.readFile(path.join(dir, file), 'utf-8');
			const fm = parseFrontmatter(raw);
			const slug = file.slice(0, -3);
			entries.push({
				slug,
				description: fm.description ?? slug,
				type: fm.type === 'discovery' ? 'discovery' : 'decision',
				date: fm.date ?? ''
			});
		} catch {
			// Skip an unreadable/corrupted entry rather than failing the whole list.
		}
	}
	entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
	return entries;
}

/** Regenerates the human-facing INDEX.md from the directory listing. Called after
 *  every write/delete; never read back by this module — it's a derived artifact. */
async function regenerateIndex(folder: string): Promise<MemoryIndexEntry[]> {
	const entries = await listEntries(folder);
	const lines = entries.map(
		(e) => `- [${e.slug}](${e.slug}.md) — ${e.description} [${e.type}, ${e.date}]`
	);
	const content = `# AI Memory Index\n\nAuto-generated — do not hand-edit, it's overwritten on the next decision/discovery.\n\n${lines.join('\n')}\n`;
	try {
		await fs.mkdir(memoryDir(folder), { recursive: true });
		await fs.writeFile(indexPath(folder), content, 'utf-8');
	} catch (err) {
		console.warn('[ai-memory] failed to write INDEX.md:', err);
	}
	return entries;
}

export async function writeEntry(
	folder: string,
	input: { type: MemoryEntryType; text: string; date?: string }
): Promise<{ slug: string; entries: MemoryIndexEntry[] }> {
	const dir = memoryDir(folder);
	assertSafe(folder, dir);
	await fs.mkdir(dir, { recursive: true });

	const date = input.date ?? new Date().toISOString().slice(0, 10);
	const base = slugify(input.text);
	const slug = await uniqueSlug(folder, base);
	const filePath = entryPath(folder, slug);
	assertSafe(folder, filePath);
	await fs.writeFile(
		filePath,
		renderEntry({ slug, type: input.type, text: input.text, date }),
		'utf-8'
	);

	const entries = await regenerateIndex(folder);
	return { slug, entries };
}

export async function removeEntry(folder: string, slug: string): Promise<MemoryIndexEntry[]> {
	const filePath = entryPath(folder, slug);
	assertSafe(folder, filePath);
	await fs.unlink(filePath).catch(() => {});
	return regenerateIndex(folder);
}

export async function readIndexEntries(folder: string): Promise<MemoryIndexEntry[]> {
	return listEntries(folder);
}

export async function readConventions(folder: string): Promise<string> {
	try {
		return await fs.readFile(conventionsPath(folder), 'utf-8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
			console.warn('[ai-memory] failed to read conventions.md:', err);
		}
		return '';
	}
}

export async function writeConventions(folder: string, text: string): Promise<void> {
	const dir = memoryDir(folder);
	const filePath = conventionsPath(folder);
	assertSafe(folder, filePath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(filePath, text, 'utf-8');
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Non-Postgres retrieval fallback — keyword overlap over entry descriptions.
 *  Proportionate to realistic entry counts (dozens–low hundreds); no new dependency. */
export async function searchMemoryLexical(
	folder: string,
	queryText: string,
	limit = 5
): Promise<Array<MemoryIndexEntry & { similarity: number }>> {
	const queryTokens = new Set(tokenize(queryText));
	if (queryTokens.size === 0) return [];

	const entries = await listEntries(folder);
	const scored = entries.map((e) => {
		const entryTokens = tokenize(e.description);
		const overlap = entryTokens.filter((t) => queryTokens.has(t)).length;
		const similarity =
			entryTokens.length > 0 ? overlap / Math.max(queryTokens.size, entryTokens.length) : 0;
		return { ...e, similarity };
	});

	return scored
		.filter((e) => e.similarity > 0)
		.sort((a, b) => b.similarity - a.similarity || b.date.localeCompare(a.date))
		.slice(0, limit);
}
