import { Terminal } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import { makeDemoCell, makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	const seedSQL = `SELECT
  range + 1 AS id,
  (['apple','banana','cherry','date','elderberry'])[FLOOR(random() * 5)::INTEGER + 1] AS fruit,
  FLOOR(random() * 100)::INTEGER AS score
FROM range(50)`;

	const introMarkdown = `# SQL Playground

A small seed table (\`sample_data\`) against the built-in DuckDB engine, plus an empty scratch cell below. Write any SQL you like — reference \`sample_data\` directly, no \`WITH\` boilerplate needed for cells you add after it.`;

	const cells: Cell[] = [
		{ ...makeDemoMarkdownCell(introMarkdown), display: 'output' },
		{ ...makeDemoCell(seedSQL, 'sample_data', 'sql'), editMode: 'prql', resultViewMode: 'table' },
		{ ...makeDemoCell('SELECT * FROM sample_data', 'scratch', 'sql'), editMode: 'prql', resultViewMode: 'table' }
	];

	return {
		id: makeDemoId(),
		name: 'SQL Playground',
		folderId: null,
		cells,
		defaultCellLanguage: 'sql',
		filters: {}
	};
}

export const sqlPlaygroundTemplate: DashboardTemplate = {
	id: 'sql-playground',
	name: 'SQL Playground',
	description: 'A seeded scratch notebook for writing ad-hoc SQL against the built-in DuckDB engine.',
	category: 'starters',
	icon: Terminal,
	build
};
