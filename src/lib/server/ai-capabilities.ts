// Capability checks for the Postgres+pgvector / Ollama-backed RAG layer. Replaces the previous
// pattern of empty `.catch(() => {})` blocks throughout `embeddings.ts` — which made "RAG is
// unavailable" indistinguishable from "RAG had no results" — with an explicit, observable,
// rate-limited signal so degraded-mode fallback is a deliberate path, not a silent one.

import { query } from './db.js';
import { getOllamaBaseUrl } from './embeddings.js';

const CAPABILITY_CACHE_TTL_MS = 60_000;

interface CapabilityState {
	value: boolean;
	checkedAt: number;
	loggedUnavailable: boolean;
}

let _postgresState: CapabilityState | null = null;
let _ollamaState: CapabilityState | null = null;

async function checkCached(
	cache: CapabilityState | null,
	setCache: (s: CapabilityState) => void,
	probe: () => Promise<boolean>,
	label: string
): Promise<boolean> {
	const now = Date.now();
	if (cache && now - cache.checkedAt < CAPABILITY_CACHE_TTL_MS) {
		return cache.value;
	}
	let value: boolean;
	try {
		value = await probe();
	} catch {
		value = false;
	}
	const loggedUnavailable = cache?.loggedUnavailable ?? false;
	if (!value && !loggedUnavailable) {
		console.warn(
			`[ai-capabilities] ${label} unavailable — RAG retrieval falls back to client-supplied schema`
		);
	}
	setCache({ value, checkedAt: now, loggedUnavailable: !value ? true : false });
	return value;
}

export async function hasPostgres(): Promise<boolean> {
	return checkCached(
		_postgresState,
		(s) => {
			_postgresState = s;
		},
		async () => {
			await query('SELECT 1');
			return true;
		},
		'Postgres'
	);
}

export async function hasOllama(): Promise<boolean> {
	return checkCached(
		_ollamaState,
		(s) => {
			_ollamaState = s;
		},
		async () => {
			const res = await fetch(`${getOllamaBaseUrl()}/api/tags`);
			return res.ok;
		},
		'Ollama'
	);
}

/** Reset cached capability state — test-only escape hatch. */
export function _resetCapabilityCacheForTests(): void {
	_postgresState = null;
	_ollamaState = null;
}
