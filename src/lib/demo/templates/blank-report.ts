import { FileText } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import { makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	const reportMarkdown = `# Report Title

{% badge value="Draft" color="warning" /%}

_One-line summary of what this report covers and who it's for._

{% callout type="info" %}
This is a starter layout, not a data notebook — add query cells above or below any section to back these placeholders with real numbers.
{% /callout %}

## Background

Context, motivation, and scope go here.

## Findings

- Finding one
- Finding two
- Finding three

{% mermaid %}
flowchart LR
  A[Data source] --> B[Analysis]
  B --> C[Finding]
  C --> D[Recommendation]
{% /mermaid %}

## Recommendation

State the recommended action and next steps.`;

	const cells: Cell[] = [{ ...makeDemoMarkdownCell(reportMarkdown), display: 'output' }];

	return {
		id: makeDemoId(),
		name: 'Report',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: {}
	};
}

export const blankReportTemplate: DashboardTemplate = {
	id: 'blank-report',
	name: 'Report',
	description: 'A structured writeup layout — background, findings, diagram, recommendation.',
	category: 'starters',
	icon: FileText,
	build
};
