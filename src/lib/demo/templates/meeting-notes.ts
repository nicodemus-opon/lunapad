import { NotebookPen } from '@lucide/svelte';
import type { Cell, Notebook } from '$lib/stores/notebook.svelte';
import { makeDemoId, makeDemoMarkdownCell } from '../cell-factory';
import type { DashboardTemplate } from './types';

function build(): Notebook {
	const notesMarkdown = `# Meeting Notes

**Date:** _fill in_ · **Attendees:** _fill in_

## Agenda

1. Item one
2. Item two
3. Item three

## Notes

_Freeform notes go here._

## Action items

- [ ] Action item — owner, due date
- [ ] Action item — owner, due date

## Next meeting

_Date / topic for follow-up._`;

	const cells: Cell[] = [{ ...makeDemoMarkdownCell(notesMarkdown), display: 'output' }];

	return {
		id: makeDemoId(),
		name: 'Meeting Notes',
		folderId: null,
		cells,
		defaultCellLanguage: 'prql',
		filters: {}
	};
}

export const meetingNotesTemplate: DashboardTemplate = {
	id: 'meeting-notes',
	name: 'Meeting Notes',
	description: 'A pure markdown journal layout — agenda, notes, and action items.',
	category: 'starters',
	icon: NotebookPen,
	build
};
