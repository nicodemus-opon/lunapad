import { describe, it, expect } from 'vitest';
import { classifyIntent, classifyComplexity } from './ai-subagents.js';

describe('classifyIntent', () => {
	it('routes model-building requests to creation', () => {
		for (const p of [
			'Create a monthly revenue analysis model from ai_sales',
			'generate a staging table for orders',
			'build a revenue metric that aggregates fct_orders',
			'make a fact table for sessions',
		]) {
			expect(classifyIntent(p), p).toBe('creation');
		}
	});

	it('routes chart/dashboard requests to dashboard', () => {
		for (const p of [
			'build a dashboard for sales',
			'plot the revenue trend by month',
			'make a chart of orders per customer',
			'visualize the breakdown of revenue by region',
			'summarize sales into a kpi',
			'chart my results',
		]) {
			expect(classifyIntent(p), p).toBe('dashboard');
		}
	});

	it('routes fix/debug requests to debug', () => {
		for (const p of [
			'fix the SQL error in monthly_sales',
			'debug this query',
			'why is this cell broken',
			'this result is wrong, fix it',
		]) {
			expect(classifyIntent(p), p).toBe('debug');
		}
	});

	it('routes analysis/explain requests to investigation', () => {
		for (const p of [
			'explain the revenue cell',
			'analyze the distribution of order amounts',
			'trace why this metric dropped',
		]) {
			expect(classifyIntent(p), p).toBe('investigation');
		}
	});

	it('keeps general questions and modification requests in standard loop', () => {
		for (const p of [
			'what tables do I have?',
			'show me the orders table',
			'rename the cell to revenue',
			'optimize the join',
			'how does this query work?',
			'update the filter to last 90 days',
		]) {
			expect(classifyIntent(p), p).toBe('standard');
		}
	});

	it('routes analytics domain terms to creation even when phrased as questions', () => {
		for (const p of [
			'show me our retention',
			'what does our funnel look like',
			'can you model customer churn',
			'how is our conversion rate trending',
			'build an RFM model',
			'create a customer LTV analysis',
			'our MRR needs a model',
			'give me attribution for marketing',
		]) {
			expect(classifyIntent(p), p).toBe('creation');
		}
	});

	it('routes give-me / build-me + model noun to creation', () => {
		for (const p of [
			'give me a staging model',
			'give me a revenue metric',
			'build me a fact table',
			'build me a new view',
		]) {
			expect(classifyIntent(p), p).toBe('creation');
		}
	});

	it('does not route show-me + simple table reference to creation', () => {
		expect(classifyIntent('show me the orders table')).toBe('standard');
		expect(classifyIntent('show me all cells')).toBe('standard');
	});
});

describe('classifyComplexity', () => {
	it('classifies analytics domain patterns as complex', () => {
		for (const p of [
			'build a retention cohort analysis',
			'create a customer churn model',
			'design an RFM segmentation model',
			'model our conversion funnel',
			'show me DAU over time',
			'build a customer LTV model',
			'create MRR tracking for subscriptions',
			'attribution model for marketing spend',
		]) {
			expect(classifyComplexity(p), p).toBe('complex');
		}
	});

	it('classifies pipeline and warehouse patterns as complex', () => {
		for (const p of [
			'build an end-to-end pipeline',
			'create a multi-layer mart',
			'design a data warehouse model',
			'build 7 models for the orders domain',
		]) {
			expect(classifyComplexity(p), p).toBe('complex');
		}
	});

	it('classifies single-field edit requests as medium (no analytics/pipeline patterns)', () => {
		for (const p of [
			'add a column to the orders table',
			'add a filter for last 30 days',
		]) {
			expect(classifyComplexity(p), p).toBe('medium');
		}
	});

	it('classifies new-model requests without analytics or pipeline terms as medium', () => {
		for (const p of [
			'create a staging table for orders',
			'build a revenue summary',
			'generate a new SQL model',
		]) {
			expect(classifyComplexity(p), p).toBe('medium');
		}
	});
});
