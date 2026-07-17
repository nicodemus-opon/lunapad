import type { OrganizationPlan } from './tenancy.js';

function firstEnvValue(value: string | undefined): string | null {
	const first = value?.split(',')[0]?.trim();
	return first || null;
}

function normalizeOrigin(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, '');
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	const local = trimmed.includes('localhost') || trimmed.startsWith('127.') || trimmed.startsWith('0.0.0.0');
	return `${local ? 'http' : 'https'}://${trimmed}`;
}

export function publicOriginEnvPresent(): boolean {
	return Boolean(
		firstEnvValue(process.env.ORIGIN) ||
			firstEnvValue(process.env.SERVICE_URL_APP_3000) ||
			firstEnvValue(process.env.SERVICE_FQDN_APP_3000) ||
			firstEnvValue(process.env.COOLIFY_URL) ||
			firstEnvValue(process.env.COOLIFY_FQDN)
	);
}

export function publicOrigin(): string {
	const value =
		firstEnvValue(process.env.ORIGIN) ||
		firstEnvValue(process.env.SERVICE_URL_APP_3000) ||
		firstEnvValue(process.env.SERVICE_FQDN_APP_3000) ||
		firstEnvValue(process.env.COOLIFY_URL) ||
		firstEnvValue(process.env.COOLIFY_FQDN) ||
		'http://localhost:3967';
	return normalizeOrigin(value);
}

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
	return publicOrigin().startsWith('https://');
}

export function secureCookieEnabled(): boolean {
	if (process.env.SECURE_COOKIES === 'false') return false;
	if (process.env.SECURE_COOKIES === 'true') return true;
	return isHttpsOrigin();
}
