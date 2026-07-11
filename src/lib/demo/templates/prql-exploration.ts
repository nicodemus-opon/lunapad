import { Wand2 } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	// random() (not range % N) for every pick — a fixed modulo cycle divides
	// evenly into round row counts and produces suspiciously uniform groups.
	const seedSQL = `SELECT
  range + 1 AS product_id,
  (['Laptop','Phone','Tablet','Monitor','Keyboard'])[FLOOR(random() * 5)::INTEGER + 1] AS product,
  (['Electronics','Peripherals'])[FLOOR(random() * 2)::INTEGER + 1] AS category,
  ROUND(20 + random() * 980, 2) AS price,
  10 + FLOOR(random() * 90)::INTEGER AS units_in_stock
FROM range(200)`;

	const filterDerivePRQL = `from products
filter price > 100
derive {
  stock_value = price * units_in_stock,
  price_tier = s"CASE WHEN price > 500 THEN 'premium' WHEN price > 200 THEN 'mid' ELSE 'budget' END"
}
sort {-stock_value}`;

	const rankedPRQL = `from products
group category (
  aggregate {
    avg_price = average price,
    total_stock_value = sum (price * units_in_stock)
  }
)
sort {-total_stock_value}
take 10`;

	const introMarkdown = `# PRQL Exploration

A product catalog (\`products\`) plus two PRQL cells demonstrating different pipeline stages: \`filter\` + \`derive\` (with an inline SQL expression via \`s"..."\`), and \`group\` + \`aggregate\` + \`take\`. Edit either cell freely, or switch to GUI pipeline mode from the cell toolbar to build one visually.`;

	const cells: Cell[] = [
		{ ...makeDemoMarkdownCell(introMarkdown), display: 'output' },
		{ ...makeDemoCell(seedSQL, 'products', 'sql'), editMode: 'prql', resultViewMode: 'stats' },
		{ ...makeDemoCell(filterDerivePRQL, 'high_value_products', 'prql'), editMode: 'prql', resultViewMode: 'table' },
		{ ...makeDemoCell(rankedPRQL, 'category_stock_value', 'prql'), editMode: 'prql', resultViewMode: 'table' }
	];

	return {
		id: makeDemoId(),
		name: 'PRQL Exploration',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: {}
	};
}

export const prqlExplorationTemplate: DashboardTemplate = {
	id: 'prql-exploration',
	name: 'PRQL Exploration',
	description: 'A product catalog with filter/derive and group/aggregate PRQL pipelines to learn from.',
	category: 'starters',
	icon: Wand2,
	build
};
