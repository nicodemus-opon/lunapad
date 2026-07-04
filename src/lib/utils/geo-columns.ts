import type { GeoScope } from '$lib/types/gui-pipeline';

function toNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const parsed = Number(String(value).trim());
	return Number.isFinite(parsed) ? parsed : null;
}

const LAT_NAME_RE = /^(lat(itude)?|y)$/i;
const LON_NAME_RE = /^(lon(g(itude)?)?|lng|x)$/i;
const LOCATION_NAME_RE = /country|state|region|iso|code|location|geo/i;

const US_STATE_CODES = new Set([
	'AL',
	'AK',
	'AZ',
	'AR',
	'CA',
	'CO',
	'CT',
	'DE',
	'FL',
	'GA',
	'HI',
	'ID',
	'IL',
	'IN',
	'IA',
	'KS',
	'KY',
	'LA',
	'ME',
	'MD',
	'MA',
	'MI',
	'MN',
	'MS',
	'MO',
	'MT',
	'NE',
	'NV',
	'NH',
	'NJ',
	'NM',
	'NY',
	'NC',
	'ND',
	'OH',
	'OK',
	'OR',
	'PA',
	'RI',
	'SC',
	'SD',
	'TN',
	'TX',
	'UT',
	'VT',
	'VA',
	'WA',
	'WV',
	'WI',
	'WY',
	'DC'
]);

function sampleValues(rows: Record<string, unknown>[], col: string, limit = 30): unknown[] {
	return rows
		.map((r) => r[col])
		.filter((v) => v != null)
		.slice(0, limit);
}

function isLatColumn(rows: Record<string, unknown>[], col: string): boolean {
	const values = sampleValues(rows, col);
	if (values.length === 0) return false;
	const numeric = values.map((v) => toNumber(v)).filter((v): v is number => v !== null);
	if (numeric.length / values.length < 0.8) return false;
	return numeric.every((v) => v >= -90 && v <= 90);
}

function isLonColumn(rows: Record<string, unknown>[], col: string): boolean {
	const values = sampleValues(rows, col);
	if (values.length === 0) return false;
	const numeric = values.map((v) => toNumber(v)).filter((v): v is number => v !== null);
	if (numeric.length / values.length < 0.8) return false;
	return numeric.every((v) => v >= -180 && v <= 180);
}

function scoreLatName(col: string): number {
	if (LAT_NAME_RE.test(col)) return 3;
	if (/lat/i.test(col)) return 2;
	return 0;
}

function scoreLonName(col: string): number {
	if (LON_NAME_RE.test(col)) return 3;
	if (/lon|lng/i.test(col)) return 2;
	return 0;
}

export function detectLatLonColumns(
	columns: string[],
	rows: Record<string, unknown>[]
): { latColumn: string | null; lonColumn: string | null } {
	if (columns.length === 0 || rows.length === 0) {
		return { latColumn: null, lonColumn: null };
	}

	let bestLat: { col: string; score: number } | null = null;
	let bestLon: { col: string; score: number } | null = null;

	for (const col of columns) {
		const latScore = scoreLatName(col) + (isLatColumn(rows, col) ? 2 : 0);
		if (latScore > 0 && (!bestLat || latScore > bestLat.score)) {
			bestLat = { col, score: latScore };
		}
		const lonScore = scoreLonName(col) + (isLonColumn(rows, col) ? 2 : 0);
		if (lonScore > 0 && (!bestLon || lonScore > bestLon.score)) {
			bestLon = { col, score: lonScore };
		}
	}

	// Fallback: any two numeric columns that pass lat/lon range checks
	if (!bestLat || !bestLon) {
		const numericGeo = columns.filter((col) => isLatColumn(rows, col) || isLonColumn(rows, col));
		const latCandidates = numericGeo.filter((col) => isLatColumn(rows, col));
		const lonCandidates = numericGeo.filter((col) => isLonColumn(rows, col) && col !== latCandidates[0]);
		if (!bestLat && latCandidates.length > 0) bestLat = { col: latCandidates[0], score: 1 };
		if (!bestLon && lonCandidates.length > 0) bestLon = { col: lonCandidates[0], score: 1 };
	}

	if (bestLat && bestLon && bestLat.col === bestLon.col) {
		return { latColumn: null, lonColumn: null };
	}

	return {
		latColumn: bestLat?.col ?? null,
		lonColumn: bestLon?.col ?? null
	};
}

function looksLikeIso3(value: string): boolean {
	return /^[A-Z]{3}$/.test(value.trim());
}

function looksLikeUsState(value: string): boolean {
	return US_STATE_CODES.has(value.trim().toUpperCase());
}

function scoreLocationColumn(col: string, rows: Record<string, unknown>[]): number {
	const values = sampleValues(rows, col).map((v) => String(v).trim()).filter(Boolean);
	if (values.length === 0) return 0;

	const isoHits = values.filter(looksLikeIso3).length;
	const stateHits = values.filter(looksLikeUsState).length;
	if (isoHits / values.length >= 0.6) return 6;
	if (stateHits / values.length >= 0.6) return 5;
	if (LOCATION_NAME_RE.test(col) && values.every((v) => v.length <= 3)) return 3;

	return 0;
}

export function detectLocationColumn(
	columns: string[],
	rows: Record<string, unknown>[]
): string | null {
	if (columns.length === 0 || rows.length === 0) return null;

	let best: { col: string; score: number } | null = null;
	for (const col of columns) {
		const score = scoreLocationColumn(col, rows);
		if (score > 0 && (!best || score > best.score)) {
			best = { col, score };
		}
	}
	return best?.col ?? null;
}

export function inferGeoScope(
	locationCol: string,
	rows: Record<string, unknown>[]
): GeoScope {
	const values = sampleValues(rows, locationCol).map((v) => String(v).trim()).filter(Boolean);
	if (values.length === 0) return 'world';

	const stateHits = values.filter(looksLikeUsState).length;
	if (stateHits / values.length >= 0.6) return 'usa-states';

	return 'world';
}

export function hasGeoPointData(columns: string[], rows: Record<string, unknown>[]): boolean {
	const { latColumn, lonColumn } = detectLatLonColumns(columns, rows);
	return latColumn !== null && lonColumn !== null;
}

export function hasChoroplethData(
	columns: string[],
	rows: Record<string, unknown>[],
	numCols: string[]
): boolean {
	if (hasGeoPointData(columns, rows)) return false;
	const locationCol = detectLocationColumn(columns, rows);
	if (!locationCol) return false;
	const metric = numCols.find((col) => col !== locationCol);
	return metric !== undefined;
}
