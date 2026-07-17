import { beforeEach, describe, expect, it } from 'vitest';
import { cloudDefaultPlan, billingProvider } from './cloud-config.js';
import { entitlementsForPlan } from './tenancy.js';

beforeEach(() => {
	delete process.env.CLOUD_DEFAULT_PLAN;
	delete process.env.BETA_DEFAULT_PLAN;
	delete process.env.BILLING_PROVIDER;
});

describe('cloud defaults', () => {
	it('uses the default starter plan', () => {
		expect(cloudDefaultPlan()).toBe('starter');
		expect(entitlementsForPlan('starter').maxProjects).toBeGreaterThan(1);
	});

	it('keeps the legacy plan environment variable as a fallback', () => {
		process.env.BETA_DEFAULT_PLAN = 'free_beta';
		expect(cloudDefaultPlan()).toBe('free_beta');
	});

	it('keeps billing manual unless explicitly disabled', () => {
		expect(billingProvider()).toBe('manual');
		process.env.BILLING_PROVIDER = 'none';
		expect(billingProvider()).toBe('none');
	});
});
