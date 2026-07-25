import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { ensureEmbeddingTablesMock, listMemoryEmbeddedSlugsMock, upsertMemoryEmbeddingMock } =
	vi.hoisted(() => ({
		ensureEmbeddingTablesMock: vi.fn().mockResolvedValue(undefined),
		listMemoryEmbeddedSlugsMock: vi.fn().mockResolvedValue(new Set()),
		upsertMemoryEmbeddingMock: vi.fn().mockResolvedValue(undefined)
	}));
vi.mock('./embeddings.js', () => ({
	ensureEmbeddingTables: ensureEmbeddingTablesMock,
	listMemoryEmbeddedSlugs: listMemoryEmbeddedSlugsMock,
	upsertMemoryEmbedding: upsertMemoryEmbeddingMock
}));

import {
	writeEntry,
	removeEntry,
	readIndexEntries,
	readConventions,
	writeConventions,
	searchMemoryLexical,
	backfillMemoryEmbeddings,
	slugify
} from './ai-memory.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-ai-memory-test-'));
	ensureEmbeddingTablesMock.mockClear();
	listMemoryEmbeddedSlugsMock.mockClear().mockResolvedValue(new Set());
	upsertMemoryEmbeddingMock.mockClear();
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('writeEntry / readIndexEntries', () => {
	it('writes an entry file and reflects it in the index', async () => {
		const { slug, entries } = await writeEntry(dir, {
			type: 'decision',
			text: 'Orders grain is one row per line item, not per order header.'
		});

		expect(slug).toBe('orders-grain-is-one-row-per');
		expect(entries).toHaveLength(1);
		expect(entries[0].slug).toBe(slug);
		expect(entries[0].type).toBe('decision');
		expect(entries[0].description).toContain('Orders grain is one row per line item');

		const raw = await fs.readFile(path.join(dir, '.lunapad', 'memory', `${slug}.md`), 'utf-8');
		expect(raw).toContain('name: orders-grain-is-one-row');
		expect(raw).toContain('type: decision');

		const index = await fs.readFile(path.join(dir, '.lunapad', 'memory', 'INDEX.md'), 'utf-8');
		expect(index).toContain(slug);

		const listed = await readIndexEntries(dir);
		expect(listed).toHaveLength(1);
		expect(listed[0].slug).toBe(slug);
	});

	it('round-trips a discovery entry', async () => {
		const { entries } = await writeEntry(dir, {
			type: 'discovery',
			text: '12% of customers.email is null, unexpected.'
		});
		expect(entries[0].type).toBe('discovery');
	});

	it('returns empty entries when the memory dir does not exist yet', async () => {
		expect(await readIndexEntries(dir)).toEqual([]);
	});
});

describe('slug collisions', () => {
	it('appends a numeric suffix when two entries slugify to the same base', async () => {
		const a = await writeEntry(dir, {
			type: 'decision',
			text: 'Orders grain is one row per line item.'
		});
		const b = await writeEntry(dir, {
			type: 'decision',
			text: 'Orders grain is one row per order header, confirmed.'
		});

		expect(a.slug).toBe('orders-grain-is-one-row-per');
		expect(b.slug).toBe('orders-grain-is-one-row-per-2');
		expect(a.slug).not.toBe(b.slug);
		const entries = await readIndexEntries(dir);
		expect(entries).toHaveLength(2);
	});
});

describe('removeEntry', () => {
	it('deletes the entry file and updates the index', async () => {
		const { slug } = await writeEntry(dir, { type: 'decision', text: 'Temporary decision.' });
		expect(await readIndexEntries(dir)).toHaveLength(1);

		const entries = await removeEntry(dir, slug);
		expect(entries).toHaveLength(0);
		await expect(fs.access(path.join(dir, '.lunapad', 'memory', `${slug}.md`))).rejects.toThrow();
	});
});

describe('backfillMemoryEmbeddings', () => {
	it('embeds only entries missing from memory_embeddings', async () => {
		await writeEntry(dir, { type: 'decision', text: 'Orders grain is one row per line item.' });
		await writeEntry(dir, { type: 'discovery', text: 'customer_id is null for guest checkouts.' });
		listMemoryEmbeddedSlugsMock.mockResolvedValueOnce(new Set(['orders-grain-is-one-row-per']));

		const result = await backfillMemoryEmbeddings(dir);

		expect(ensureEmbeddingTablesMock).toHaveBeenCalledTimes(1);
		expect(upsertMemoryEmbeddingMock).toHaveBeenCalledTimes(1);
		expect(upsertMemoryEmbeddingMock).toHaveBeenCalledWith(
			expect.objectContaining({ slug: 'customerid-is-null-for-guest-checkouts' })
		);
		expect(result).toEqual({ backfilled: 1, total: 2 });
	});

	it('is a no-op (idempotent) when everything is already embedded', async () => {
		await writeEntry(dir, { type: 'decision', text: 'Orders grain is one row per line item.' });
		listMemoryEmbeddedSlugsMock.mockResolvedValueOnce(new Set(['orders-grain-is-one-row-per']));

		const result = await backfillMemoryEmbeddings(dir);

		expect(upsertMemoryEmbeddingMock).not.toHaveBeenCalled();
		expect(result).toEqual({ backfilled: 0, total: 1 });
	});

	it('running it twice in a row backfills nothing the second time', async () => {
		await writeEntry(dir, { type: 'decision', text: 'Orders grain is one row per line item.' });
		listMemoryEmbeddedSlugsMock.mockResolvedValueOnce(new Set());
		const first = await backfillMemoryEmbeddings(dir);
		expect(first.backfilled).toBe(1);

		listMemoryEmbeddedSlugsMock.mockResolvedValueOnce(new Set(['orders-grain-is-one-row-per']));
		const second = await backfillMemoryEmbeddings(dir);
		expect(second.backfilled).toBe(0);
	});
});

describe('adversarial content', () => {
	it('survives a decision containing literal frontmatter-fence and colon characters', async () => {
		const text =
			'Watch out: revenue --- column can be negative: refunds are stored as positive amounts.';
		const { slug, entries } = await writeEntry(dir, { type: 'discovery', text });

		expect(entries).toHaveLength(1);
		expect(entries[0].description).toContain('revenue --- column');

		// Re-scanning from disk must still find exactly one entry, not be broken by the
		// embedded "---" mid-line confusing the frontmatter-block parser.
		const reread = await readIndexEntries(dir);
		expect(reread).toHaveLength(1);
		expect(reread[0].slug).toBe(slug);
	});

	it('strips embedded newlines so they never reach the frontmatter block', async () => {
		const text =
			'Line one of a decision.\nLine two that should not break parsing.\n---\nLine three.';
		const { entries } = await writeEntry(dir, { type: 'decision', text });

		expect(entries).toHaveLength(1);
		expect(entries[0].description).not.toContain('\n');
		expect(entries[0].description).toContain('Line one of a decision. Line two');
	});
});

describe('conventions.md', () => {
	it('round-trips raw freeform text, including markdown headings', async () => {
		const text =
			'Always use UTC timestamps.\n\n## Decisions\nThis heading-like text must not be parsed.';
		await writeConventions(dir, text);
		expect(await readConventions(dir)).toBe(text);
	});

	it('returns empty string when conventions.md does not exist yet', async () => {
		expect(await readConventions(dir)).toBe('');
	});
});

describe('searchMemoryLexical', () => {
	it('ranks entries by keyword overlap with the query', async () => {
		await writeEntry(dir, { type: 'decision', text: 'Orders grain is one row per line item.' });
		await writeEntry(dir, {
			type: 'discovery',
			text: 'Customers email column has a high null rate.'
		});

		const results = await searchMemoryLexical(dir, 'what is the grain of orders', 5);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].description).toContain('Orders grain');
	});

	it('returns no results for a query with no overlapping tokens', async () => {
		await writeEntry(dir, { type: 'decision', text: 'Orders grain is one row per line item.' });
		const results = await searchMemoryLexical(dir, 'zzz qqq nonexistent', 5);
		expect(results).toEqual([]);
	});
});

describe('slugify', () => {
	it('falls back to a default slug for text with no alphanumeric content', () => {
		expect(slugify('!!!')).toBe('entry');
	});
});
