/**
 * Convert an Arrow cell value to a plain JSON-serializable JS value.
 * STRUCT/LIST/MAP columns come back as Arrow StructRow/Vector wrappers
 * (unwrapped via toJSON), and BigInts can appear at any nesting depth.
 * Non-bigint typed arrays pass through untouched: HUGEINT/DECIMAL limbs
 * arrive as Uint32Array and are decoded downstream (tryDecodeHugeIntLike).
 */
export function arrowValueToJS(val: unknown): unknown {
	if (val === null || val === undefined) return val;
	if (typeof val === 'bigint') {
		const asNumber = Number(val);
		return Number.isSafeInteger(asNumber) ? asNumber : val.toString();
	}
	if (val instanceof Date) return val;
	if (val instanceof BigInt64Array || val instanceof BigUint64Array) {
		return Array.from(val, (v) => arrowValueToJS(v));
	}
	if (ArrayBuffer.isView(val)) return val;
	if (Array.isArray(val)) return val.map((entry) => arrowValueToJS(entry));
	if (typeof val === 'object') {
		const withToJSON = val as { toJSON?: () => unknown };
		if (typeof withToJSON.toJSON === 'function') {
			return arrowValueToJS(withToJSON.toJSON());
		}
		return Object.fromEntries(
			Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, arrowValueToJS(v)])
		);
	}
	return val;
}
