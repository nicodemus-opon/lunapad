import type { OrganizationPlan } from './tenancy.js';

export function cloudDefaultPlan(): OrganizationPlan {
	const plan = process.env.CLOUD_DEFAULT_PLAN ?? process.env.BETA_DEFAULT_PLAN;
	if (plan === 'team' || plan === 'business' || plan === 'starter' || plan === 'free_beta') {
		return plan;
	}
	return 'starter';
}

export function billingProvider(): 'none' | 'manual' {
	return process.env.BILLING_PROVIDER === 'none' ? 'none' : 'manual';
}

export function cloudSignupOpen(): boolean {
	return process.env.PUBLIC_CLOUD_SIGNUP_ENABLED !== 'false';
}

export function isHttpsOrigin(): boolean {
	return (process.env.ORIGIN ?? '').startsWith('https://');
}

export function secureCookieEnabled(): boolean {
	if (process.env.SECURE_COOKIES === 'false') return false;
	if (process.env.SECURE_COOKIES === 'true') return true;
	return isHttpsOrigin();
}
