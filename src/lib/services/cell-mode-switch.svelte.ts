import { compilePRQL } from '$lib/services/prql';
import {
	prqlToGuiStages,
	extractLetBindings,
	mergeParsedWithHiddenStages
} from '$lib/services/gui-prql';
import {
	setEditMode,
	setCellLanguage,
	updateCellCode,
	updateGuiStages,
	insertCellBefore,
	type Cell
} from '$lib/stores/notebook.svelte';
import type { PRQLTarget } from '$lib/types/connection';

export type CellMode = 'prql' | 'visual' | 'sql';

/**
 * Collapses a query cell's `language` + `editMode` into a single tri-state used
 * by the PRQL / Visual / SQL toggle.
 */
export function cellModeOf(cell: Cell): CellMode {
	return cell.language === 'sql' ? 'sql' : cell.editMode === 'gui' ? 'visual' : 'prql';
}

/**
 * Shared controller for the PRQL / Visual / SQL cell-mode toggle. Owns the
 * confirmation-dialog state and the (non-trivial) switch logic so both the
 * classic notebook renderer and the WYSIWYG inline query blocks stay in sync.
 *
 * Confirmation flags are `$state` fields, so they can be `bind:`-ed straight
 * into `CellModeSwitchDialogs`.
 */
export class CellModeSwitch {
	#getCell: () => Cell | null;
	#getSqlDialect: () => PRQLTarget;

	confirmSwitchToGui = $state(false);
	confirmSwitchToSql = $state<false | 'with-code' | 'without-code'>(false);
	confirmSwitchToPrql = $state(false);
	#compiledSqlForSwitch = '';

	constructor(getCell: () => Cell | null, getSqlDialect: () => PRQLTarget) {
		this.#getCell = getCell;
		this.#getSqlDialect = getSqlDialect;
	}

	get mode(): CellMode | null {
		const cell = this.#getCell();
		return cell ? cellModeOf(cell) : null;
	}

	setMode = (mode: CellMode) => {
		const cell = this.#getCell();
		if (!cell) return;

		if (mode === 'sql') {
			if (cell.editMode === 'gui') this.#switchToPrqlEditMode(cell);
			if (cell.language !== 'sql' && cell.code.trim()) {
				const result = compilePRQL(cell.code, this.#getSqlDialect());
				if (result.errors.length === 0 && result.sql) {
					this.#compiledSqlForSwitch = result.sql;
					this.confirmSwitchToSql = 'with-code';
				} else {
					this.confirmSwitchToSql = 'without-code';
				}
			} else {
				setCellLanguage(cell.id, 'sql');
			}
		} else if (mode === 'prql') {
			if (cell.editMode === 'gui') this.#switchToPrqlEditMode(cell);
			if (cell.language === 'sql' && cell.code.trim()) {
				this.confirmSwitchToPrql = true;
			} else {
				setCellLanguage(cell.id, 'prql');
			}
		} else {
			if (cell.language === 'sql') setCellLanguage(cell.id, 'prql');
			this.#requestGuiMode(cell);
		}
	};

	doSwitchToGui = () => {
		const cell = this.#getCell();
		this.confirmSwitchToGui = false;
		if (!cell) return;
		updateGuiStages(cell.id, [{ type: 'from', table: '' }]);
		setEditMode(cell.id, 'gui');
	};

	doSwitchToSql = (useCompiledCode: boolean) => {
		const cell = this.#getCell();
		this.confirmSwitchToSql = false;
		if (!cell) return;
		setCellLanguage(cell.id, 'sql');
		if (useCompiledCode && this.#compiledSqlForSwitch) {
			updateCellCode(cell.id, this.#compiledSqlForSwitch);
		}
		this.#compiledSqlForSwitch = '';
	};

	doSwitchToPrql = () => {
		const cell = this.#getCell();
		this.confirmSwitchToPrql = false;
		if (!cell) return;
		setCellLanguage(cell.id, 'prql');
	};

	#switchToPrqlEditMode(cell: Cell) {
		setEditMode(cell.id, 'prql');
	}

	#requestGuiMode(cell: Cell) {
		if (cell.editMode !== 'prql') {
			setEditMode(cell.id, 'gui');
			return;
		}

		const trimmed = cell.code.trim();
		if (!trimmed) {
			setEditMode(cell.id, 'gui');
			return;
		}

		// If the PRQL has `let` bindings, split into separate cells
		const { letBindings, mainPrql } = extractLetBindings(cell.code);
		if (letBindings.length > 0) {
			for (const binding of letBindings) {
				const innerStages = prqlToGuiStages(binding.rawCode);
				insertCellBefore(cell.id, {
					outputName: binding.name,
					code: binding.rawCode,
					guiStages: innerStages ?? [{ type: 'from', table: '' }],
					editMode: innerStages ? 'gui' : 'prql'
				});
			}
			const mainStages = prqlToGuiStages(mainPrql);
			if (mainStages) {
				updateGuiStages(cell.id, mergeParsedWithHiddenStages(cell.guiStages, mainStages));
				setEditMode(cell.id, 'gui');
			} else {
				updateCellCode(cell.id, mainPrql);
				// keep prql mode — main pipeline couldn't be parsed
			}
			return;
		}

		const parsedStages = prqlToGuiStages(cell.code);
		if (parsedStages) {
			updateGuiStages(cell.id, mergeParsedWithHiddenStages(cell.guiStages, parsedStages));
			setEditMode(cell.id, 'gui');
			return;
		}

		this.confirmSwitchToGui = true;
	}
}

export function createCellModeSwitch(
	getCell: () => Cell | null,
	getSqlDialect: () => PRQLTarget
): CellModeSwitch {
	return new CellModeSwitch(getCell, getSqlDialect);
}
