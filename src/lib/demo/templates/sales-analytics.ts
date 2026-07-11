import { TrendingUp, Gauge } from '@lucide/svelte';
import type { Notebook } from '$lib/stores/notebook.svelte';
import { buildSalesAnalyticsDemo, DEMO_NOTEBOOK_NAME } from '../sales-analytics-demo';
import type { DashboardTemplate } from './types';

export const salesAnalyticsTemplate: DashboardTemplate = {
	id: 'sales-analytics',
	name: DEMO_NOTEBOOK_NAME,
	description: 'KPIs, regional filters, tabs, and charts on synthetic order data.',
	category: 'analytics',
	icon: TrendingUp,
	build: buildSalesAnalyticsDemo
};

export const executiveKpiTemplate: DashboardTemplate = {
	id: 'executive-kpi',
	name: 'Executive KPI',
	description: 'Minimal KPI grid with period comparison placeholders.',
	category: 'analytics',
	icon: Gauge,
	build: (): Notebook => {
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
};
