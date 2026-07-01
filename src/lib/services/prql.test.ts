import { describe, expect, it } from 'vitest';

import { sanitizePRQLInput } from '$lib/services/prql';

describe('sanitizePRQLInput', () => {
	it('extracts fenced prql blocks from markdown responses', () => {
		const input = `Here is the query you can run.

\`\`\`prql
from sales
group category (
	aggregate {
		total = sum amount
	}
)
sort {-total}
\`\`\`

This summarizes revenue by category.`;

		expect(sanitizePRQLInput(input)).toBe(`from sales
group category (
	aggregate {
		total = sum amount
	}
)
sort {-total}`);
	});

	it('drops trailing markdown prose after a top-level PRQL pipeline', () => {
		const input = `from wg
derive {
	revenue = \`Price (GHS)\` * \`Units Sold\`
}
sort {-revenue}

**Key caveat:** The date analysis assumes your PRQL target database supports \`TO_DATE(..., 'DD/MM/YYYY')\` syntax.`;

		expect(sanitizePRQLInput(input)).toBe(`from wg
derive {
	revenue = \`Price (GHS)\` * \`Units Sold\`
}
sort {-revenue}`);
	});

	it('leaves plain PRQL untouched', () => {
		const input = `from sales
filter revenue > 100
take 20`;

		expect(sanitizePRQLInput(input)).toBe(input);
	});
});
