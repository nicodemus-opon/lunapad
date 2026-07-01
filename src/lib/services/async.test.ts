import { describe, expect, it } from 'vitest';

import { withTimeout } from '$lib/services/async';

describe('withTimeout', () => {
	it('returns the resolved value before timeout', async () => {
		await expect(withTimeout(Promise.resolve('ok'), 'quick op', 50)).resolves.toBe('ok');
	});

	it('rejects with a timeout error if the promise does not settle', async () => {
		const never = new Promise<string>(() => {
			// Intentionally unresolved.
		});
		await expect(withTimeout(never, 'slow op', 20)).rejects.toThrow('slow op timed out after 20ms');
	});
});
