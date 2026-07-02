/** Local recency ranking for SQL completion (DataGrip ML-lite). */

const STORAGE_KEY = 'lunapad_sql_completion_recency';
const MAX_ENTRIES = 500;

type RecencyMap = Record<string, number>;

function loadMap(): RecencyMap {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as RecencyMap) : {};
	} catch {
		return {};
	}
}

function saveMap(map: RecencyMap): void {
	if (typeof localStorage === 'undefined') return;
	const entries = Object.entries(map)
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_ENTRIES);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
	} catch {
		// quota exceeded — ignore
	}
}

function recencyKey(connectionId: string | undefined, label: string): string {
	return `${connectionId ?? 'default'}::${label.toLowerCase()}`;
}

/** Score boost (0–20) based on how recently this label was accepted. */
export function getRecencyScore(connectionId: string | undefined, label: string): number {
	const map = loadMap();
	const ts = map[recencyKey(connectionId, label)];
	if (!ts) return 0;
	const ageMs = Date.now() - ts;
	const dayMs = 86_400_000;
	if (ageMs < dayMs) return 20;
	if (ageMs < dayMs * 7) return 12;
	if (ageMs < dayMs * 30) return 6;
	return 2;
}

/** Record that the user accepted a completion item. */
export function recordCompletionAcceptance(connectionId: string | undefined, label: string): void {
	const map = loadMap();
	map[recencyKey(connectionId, label)] = Date.now();
	saveMap(map);
}
