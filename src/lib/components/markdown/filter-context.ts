export const FILTER_CONTEXT_KEY = Symbol('filter-context');

export interface FilterContextValue {
	getValue(param: string): string;
	setValue(param: string, value: string): void;
}
