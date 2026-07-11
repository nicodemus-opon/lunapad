import type { Component } from 'svelte';
import type { Notebook } from '$lib/stores/notebook.svelte';

export type TemplateCategory = 'analytics' | 'starters';

export interface DashboardTemplate {
	id: string;
	name: string;
	description: string;
	category: TemplateCategory;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	icon: Component<any>;
	build: () => Notebook;
}

export interface TemplateCategoryGroup {
	id: TemplateCategory;
	label: string;
	templates: DashboardTemplate[];
}
