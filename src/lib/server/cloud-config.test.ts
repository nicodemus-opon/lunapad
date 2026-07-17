import { beforeEach, describe, expect, it } from 'vitest';
import { billingProvider, cloudDefaultPlan, publicOrigin, publicOriginEnvPresent } from './cloud-config.js';
import { entitlementsForPlan } from './tenancy.js';

beforeEach(() => {
	delete process.env.ORIGIN;
	delete process.env.SERVICE_URL_APP_3000;
	delete process.env.SERVICE_FQDN_APP_3000;
	delete process.env.COOLIFY_URL;
	delete process.env.COOLIFY_FQDN;
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

	it('accepts Coolify generated public URLs as the app origin', () => {
		process.env.SERVICE_URL_APP_3000 = 'https://lunapad.example.com';
		expect(publicOriginEnvPresent()).toBe(true);
		expect(publicOrigin()).toBe('https://lunapad.example.com');
	});

	it('normalizes Coolify generated FQDNs when no scheme is present', () => {
		process.env.SERVICE_FQDN_APP_3000 = 'lunapad.example.com:3000';
		expect(publicOrigin()).toBe('https://lunapad.example.com:3000');
	});
});
