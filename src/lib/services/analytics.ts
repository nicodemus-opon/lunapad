import { afterNavigate } from '$app/navigation';
import { browser } from '$app/environment';
import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_n63GYG66kYBswVZo2ur7CUCqx5dnZf9AS33MExqfVFtZ';
const POSTHOG_HOST = 'https://us.i.posthog.com';
const CONSENT_KEY = 'lunapad.analytics.consent';

type AnalyticsConsent = 'accepted' | 'declined';

type AnalyticsProperties = Record<
	string,
	string | number | boolean | null | undefined | string[] | number[] | boolean[]
>;

let initialized = false;
let navigationTrackingStarted = false;
let lastIdentifiedUserId: string | null = null;

function getStoredConsent(): AnalyticsConsent | null {
	if (!browser) return null;
	const value = localStorage.getItem(CONSENT_KEY);
	return value === 'accepted' || value === 'declined' ? value : null;
}

export function getAnalyticsConsent(): AnalyticsConsent | null {
	return getStoredConsent();
}

export function hasAnalyticsConsent(): boolean {
	return getStoredConsent() === 'accepted';
}

export function initAnalytics(): void {
	if (!browser || initialized || !hasAnalyticsConsent()) return;

	posthog.init(POSTHOG_KEY, {
		api_host: POSTHOG_HOST,
		defaults: '2026-05-30',
		capture_pageview: false,
		capture_pageleave: true,
		autocapture: false,
		disable_session_recording: true,
		respect_dnt: true,
		persistence: 'localStorage+cookie'
	});

	initialized = true;
}

export function setAnalyticsConsent(consent: AnalyticsConsent): void {
	if (!browser) return;
	localStorage.setItem(CONSENT_KEY, consent);

	if (consent === 'accepted') {
		initAnalytics();
		trackEvent('analytics_consent_updated', { consent: 'accepted' });
		return;
	}

	if (initialized) {
		posthog.capture('analytics_consent_updated', { consent: 'declined' });
		posthog.reset();
		posthog.opt_out_capturing();
	}
	initialized = false;
	lastIdentifiedUserId = null;
}

export function startAnalyticsNavigationTracking(): void {
	if (!browser || navigationTrackingStarted) return;
	navigationTrackingStarted = true;

	afterNavigate(({ to }) => {
		if (!to?.url) return;
		trackEvent('$pageview', {
			$current_url: to.url.href,
			pathname: to.url.pathname,
			search_present: to.url.search.length > 0
		});
	});
}

export function identifyAnalyticsUser(
	user: { id?: string; role?: string | null } | null | undefined
): void {
	if (!browser || !initialized) return;

	const userId = user?.id ?? null;
	const role = user?.role ?? 'member';
	if (!userId) {
		if (lastIdentifiedUserId) {
			posthog.reset();
			lastIdentifiedUserId = null;
		}
		return;
	}

	if (lastIdentifiedUserId === userId) return;
	posthog.identify(userId, {
		role
	});
	lastIdentifiedUserId = userId;
}

export function trackEvent(eventName: string, properties: AnalyticsProperties = {}): void {
	if (!browser || !initialized) return;
	posthog.capture(eventName, {
		app: 'lunapad',
		...properties
	});
}
