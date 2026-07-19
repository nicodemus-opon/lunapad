import type { ChartConfig } from '$lib/types/gui-pipeline';

export type ControlCellKind =
	| 'text-input'
	| 'number-input'
	| 'slider'
	| 'date-input'
	| 'date-range'
	| 'checkbox'
	| 'select'
	| 'multiselect'
	| 'run-button'
	| 'file-upload'
	| 'table-input'
	| 'map'
	| 'table-display'
	| 'pivot'
	| 'single-value'
	| 'writeback'
	| 'agent';

export type ControlCellStatus =
	| 'unconfigured'
	| 'valid'
	| 'stale'
	| 'running'
	| 'success'
	| 'error'
	| 'permission-blocked'
	| 'empty-data'
	| 'disabled';

export interface ControlOption {
	label: string;
	value: string;
}

export interface ControlValidation {
	required?: boolean;
	min?: number;
	max?: number;
	step?: number;
	accept?: string;
	maxBytes?: number;
}

export interface EditableTableData {
	columns: string[];
	rows: Record<string, unknown>[];
}

export interface ControlCellConfig {
	name: string;
	label: string;
	kind: ControlCellKind;
	value: unknown;
	defaultValue: unknown;
	options: ControlOption[];
	source: {
		cellId?: string | null;
		cellName?: string | null;
		columns?: string[];
		mode?: 'manual' | 'nearest-result' | 'upstream-result';
	};
	validation: ControlValidation;
	display: {
		variant?: 'inline' | 'panel' | 'compact';
		width?: 'auto' | 'full';
		placeholder?: string;
		helpText?: string;
	};
	description: string;
	status: ControlCellStatus;
	error: string | null;
	autoRun: boolean;
	runTarget: 'dependents' | 'all' | 'none';
	tableData?: EditableTableData;
	chartConfig?: ChartConfig | null;
	writeback?: {
		connectionId: string | null;
		target: string;
		mode: 'manual' | 'app' | 'scheduled';
		allowWrite: boolean;
	};
	agent?: {
		instruction: string;
		scope: 'notebook' | 'upstream' | 'selected-cells';
	};
}

const CONTROL_DEFAULTS: Record<
	ControlCellKind,
	{
		label: string;
		value: unknown;
		defaultValue: unknown;
		description: string;
		options?: ControlOption[];
		validation?: ControlValidation;
		display?: ControlCellConfig['display'];
		runTarget?: ControlCellConfig['runTarget'];
		tableData?: EditableTableData;
	}
> = {
	'text-input': {
		label: 'Text input',
		value: '',
		defaultValue: '',
		description: 'A text parameter available to SQL, PRQL, Python, and report widgets.',
		display: { placeholder: 'Type a value' }
	},
	'number-input': {
		label: 'Number input',
		value: 0,
		defaultValue: 0,
		description: 'A numeric parameter for thresholds, limits, and calculations.',
		validation: { step: 1 }
	},
	slider: {
		label: 'Slider',
		value: 50,
		defaultValue: 50,
		description: 'A bounded numeric parameter with quick visual adjustment.',
		validation: { min: 0, max: 100, step: 1 }
	},
	'date-input': {
		label: 'Date input',
		value: '',
		defaultValue: '',
		description: 'A date parameter for filtering models and reports.'
	},
	'date-range': {
		label: 'Date range',
		value: { start: '', end: '' },
		defaultValue: { start: '', end: '' },
		description: 'A paired start/end date parameter.'
	},
	checkbox: {
		label: 'Checkbox',
		value: false,
		defaultValue: false,
		description: 'A boolean parameter for toggles and optional filters.'
	},
	select: {
		label: 'Select',
		value: 'active',
		defaultValue: 'active',
		description: 'A single-choice parameter.',
		options: [
			{ label: 'Active', value: 'active' },
			{ label: 'Pending', value: 'pending' }
		]
	},
	multiselect: {
		label: 'Multiselect',
		value: ['active'],
		defaultValue: ['active'],
		description: 'A multi-choice parameter.',
		options: [
			{ label: 'Active', value: 'active' },
			{ label: 'Pending', value: 'pending' },
			{ label: 'Archived', value: 'archived' }
		]
	},
	'run-button': {
		label: 'Run button',
		value: false,
		defaultValue: false,
		description: 'A submit control for explicit app-style runs.',
		runTarget: 'dependents'
	},
	'file-upload': {
		label: 'File upload',
		value: null,
		defaultValue: null,
		description: 'A file reference parameter with local validation.',
		validation: { maxBytes: 10 * 1024 * 1024 },
		display: {
			helpText:
				'Files are validated in-browser and exposed as metadata until upload storage is configured.'
		}
	},
	'table-input': {
		label: 'Editable table',
		value: null,
		defaultValue: null,
		description: 'A small editable table that downstream cells can read.',
		tableData: {
			columns: ['key', 'value'],
			rows: [
				{ key: 'current', value: 12 },
				{ key: 'comparison', value: 8 }
			]
		}
	},
	map: {
		label: 'Map',
		value: null,
		defaultValue: null,
		description: 'A map view wired to the nearest upstream result.'
	},
	'table-display': {
		label: 'Rich table',
		value: null,
		defaultValue: null,
		description: 'A formatted, filterable table display for upstream data.'
	},
	pivot: {
		label: 'Pivot',
		value: null,
		defaultValue: null,
		description: 'A pivot summary from the nearest upstream result.'
	},
	'single-value': {
		label: 'Single value',
		value: null,
		defaultValue: null,
		description: 'A big-number metric with optional comparison.'
	},
	writeback: {
		label: 'Writeback',
		value: null,
		defaultValue: null,
		description: 'A guarded writeback action for supported external connections.',
		runTarget: 'none'
	},
	agent: {
		label: 'Agent block',
		value: '',
		defaultValue: '',
		description: 'A scoped AI instruction block for the notebook.',
		runTarget: 'none',
		display: { placeholder: 'Describe the analysis step' }
	}
};

export function defaultControlCellConfig(kind: ControlCellKind, name: string): ControlCellConfig {
	const base = CONTROL_DEFAULTS[kind];
	return {
		name,
		label: base.label,
		kind,
		value: structuredCloneSafe(base.value),
		defaultValue: structuredCloneSafe(base.defaultValue),
		options: base.options ? structuredCloneSafe(base.options) : [],
		source: {
			mode:
				kind === 'map' || kind === 'table-display' || kind === 'pivot' || kind === 'single-value'
					? 'nearest-result'
					: 'manual'
		},
		validation: base.validation ? { ...base.validation } : {},
		display: { variant: 'panel', width: 'full', ...(base.display ?? {}) },
		description: base.description,
		status: kind === 'writeback' ? 'permission-blocked' : 'valid',
		error: kind === 'writeback' ? 'Choose a connection and enable writes before running.' : null,
		autoRun: false,
		runTarget: base.runTarget ?? 'dependents',
		tableData: base.tableData ? structuredCloneSafe(base.tableData) : undefined,
		chartConfig: null,
		writeback:
			kind === 'writeback'
				? { connectionId: null, target: '', mode: 'manual', allowWrite: false }
				: undefined,
		agent: kind === 'agent' ? { instruction: '', scope: 'notebook' } : undefined
	};
}

export function normalizeControlCellConfig(
	raw: unknown,
	fallbackKind: ControlCellKind,
	fallbackName: string
): ControlCellConfig {
	const base = defaultControlCellConfig(fallbackKind, fallbackName);
	if (!raw || typeof raw !== 'object') return base;
	const c = raw as Partial<ControlCellConfig>;
	const kind = isControlCellKind(c.kind) ? c.kind : fallbackKind;
	const normalized = defaultControlCellConfig(kind, fallbackName);
	return {
		...normalized,
		...c,
		name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : fallbackName,
		label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : normalized.label,
		kind,
		options: Array.isArray(c.options)
			? c.options
					.filter((o): o is ControlOption => Boolean(o) && typeof o === 'object')
					.map((o) => ({
						label: String((o as ControlOption).label ?? (o as ControlOption).value ?? ''),
						value: String((o as ControlOption).value ?? (o as ControlOption).label ?? '')
					}))
					.filter((o) => o.value)
			: normalized.options,
		source: { ...normalized.source, ...(c.source && typeof c.source === 'object' ? c.source : {}) },
		validation: {
			...normalized.validation,
			...(c.validation && typeof c.validation === 'object' ? c.validation : {})
		},
		display: {
			...normalized.display,
			...(c.display && typeof c.display === 'object' ? c.display : {})
		},
		description: typeof c.description === 'string' ? c.description : normalized.description,
		status: isControlCellStatus(c.status) ? c.status : normalized.status,
		error: typeof c.error === 'string' ? c.error : normalized.error,
		autoRun: Boolean(c.autoRun),
		runTarget:
			c.runTarget === 'all' || c.runTarget === 'none' || c.runTarget === 'dependents'
				? c.runTarget
				: normalized.runTarget,
		tableData:
			c.tableData && Array.isArray(c.tableData.columns) && Array.isArray(c.tableData.rows)
				? c.tableData
				: normalized.tableData,
		chartConfig: c.chartConfig ?? normalized.chartConfig,
		writeback:
			c.writeback && typeof c.writeback === 'object'
				? { ...normalized.writeback, ...c.writeback }
				: normalized.writeback,
		agent:
			c.agent && typeof c.agent === 'object'
				? { ...normalized.agent, ...c.agent }
				: normalized.agent
	};
}

export function isControlCellKind(value: unknown): value is ControlCellKind {
	return typeof value === 'string' && value in CONTROL_DEFAULTS;
}

function isControlCellStatus(value: unknown): value is ControlCellStatus {
	return (
		value === 'unconfigured' ||
		value === 'valid' ||
		value === 'stale' ||
		value === 'running' ||
		value === 'success' ||
		value === 'error' ||
		value === 'permission-blocked' ||
		value === 'empty-data' ||
		value === 'disabled'
	);
}

export function isInputControlKind(kind: ControlCellKind): boolean {
	return (
		kind === 'text-input' ||
		kind === 'number-input' ||
		kind === 'slider' ||
		kind === 'date-input' ||
		kind === 'date-range' ||
		kind === 'checkbox' ||
		kind === 'select' ||
		kind === 'multiselect' ||
		kind === 'run-button' ||
		kind === 'file-upload'
	);
}

function structuredCloneSafe<T>(value: T): T {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as T;
}
