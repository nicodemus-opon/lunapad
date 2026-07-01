export const FILTER_CONTEXT_KEY = Symbol('filter-context');
export const SUPPRESS_INLINE_FILTERS_KEY = Symbol('suppress-inline-filters');
export const DRILL_CONTEXT_KEY = Symbol('drill-context');

export interface FilterContextValue {
	getValue(param: string): string;
	setValue(param: string, value: string): void;
	setValues?: (values: Record<string, string>) => void;
}

export interface DrillContextValue {
	openDetail?: (outputName: string, label?: string) => void;
}
