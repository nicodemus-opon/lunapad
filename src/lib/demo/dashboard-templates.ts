import type { Notebook } from '$lib/stores/notebook.svelte';
import { buildSalesAnalyticsDemo } from './sales-analytics-demo';

export interface DashboardTemplate {
	id: string;
	name: string;
	description: string;
	build: () => Notebook;
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
	{
		id: 'sales-analytics',
		name: 'Sales Analytics',
		description: 'KPIs, regional filters, tabs, and charts on sample order data.',
		build: buildSalesAnalyticsDemo
	},
	{
		id: 'executive-kpi',
		name: 'Executive KPI',
		description: 'Minimal KPI grid with period comparison placeholders.',
		build: () => {
			const nb = buildSalesAnalyticsDemo();
			nb.name = 'Executive KPI';
			const md = nb.cells.find((c) => c.markdown?.includes('{% tabs %}'));
			if (md) {
				md.markdown = `## Executive summary

{% filter kind="relative-date" param="range" startParam="start" endParam="end" label="Period" /%}

{% grid cols=3 %}
{% metric value=$monthly_revenue.total_revenue label="Revenue" format="currency" vs=$region_performance.quota /%}
{% metric value=$orders.count label="Orders" /%}
{% metric value=$quota_attainment.attainment_pct label="Quota %" format="percent" /%}
{% /grid %}

{% chart type="line" data=$monthly_revenue.rows x="month" y="total_revenue" title="Revenue trend" filterParam="region" filterColumn="region" /%}`;
			}
			return nb;
		}
	}
];

export function getDashboardTemplate(id: string): DashboardTemplate | undefined {
	return DASHBOARD_TEMPLATES.find((t) => t.id === id);
}
