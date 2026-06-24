/** Returns `base` if it isn't in `existing`, otherwise the first `base_copy`,
 *  `base_copy2`, ... that isn't. */
export function deconflictName(existing: Set<string> | string[], base: string): string {
	const set = existing instanceof Set ? existing : new Set(existing);
	if (!base || !set.has(base)) return base;
	let candidate = `${base}_copy`;
	let i = 2;
	while (set.has(candidate)) candidate = `${base}_copy${i++}`;
	return candidate;
}
