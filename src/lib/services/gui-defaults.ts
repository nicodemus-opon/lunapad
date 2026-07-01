import { guiToPreql } from '$lib/services/gui-prql';
import type { GUIPipelineStage } from '$lib/types/gui-pipeline';

export interface OutputRefCell {
	id: string;
	outputName: string;
}

export function getCellOutputReference(cell: OutputRefCell): string {
	return cell.outputName || `_cell_${cell.id}`;
}

export function getPreviousCellOutputReference(cells: OutputRefCell[]): string {
	if (cells.length === 0) return '';
	return getCellOutputReference(cells[cells.length - 1]);
}

export function makeInheritedGuiStages(sourceName = ''): GUIPipelineStage[] {
	return [{ type: 'from', table: sourceName }];
}

export function makeInheritedGuiCode(sourceName: string): string {
	return guiToPreql(makeInheritedGuiStages(sourceName));
}
