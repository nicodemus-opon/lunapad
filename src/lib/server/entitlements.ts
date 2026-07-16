import type { Entitlements } from './tenancy.js';
import { countActiveCloudJobs } from './cloud-jobs.js';

export class EntitlementError extends Error {
	readonly code: string;
	readonly limit: number;
	readonly usage: number;
	readonly resetAt?: string;

	constructor(
		code: string,
		limit: number,
		message: string,
		opts: { usage?: number; resetAt?: string } = {}
	) {
		super(message);
		this.name = 'EntitlementError';
		this.code = code;
		this.limit = limit;
		this.usage = opts.usage ?? limit;
		this.resetAt = opts.resetAt;
	}
}

export interface EntitlementViolation {
	code: string;
	limit: number;
	usage: number;
	resetAt?: string;
}

export function entitlementViolation(error: EntitlementError): EntitlementViolation {
	return {
		code: error.code,
		limit: error.limit,
		usage: error.usage,
		resetAt: error.resetAt
	};
}

export async function assertConcurrentJobEntitlement(input: {
	orgId: string;
	entitlements: Entitlements;
}): Promise<void> {
	const active = await countActiveCloudJobs(input.orgId);
	if (active >= input.entitlements.maxConcurrentJobs) {
		throw new EntitlementError(
			'max_concurrent_jobs',
			input.entitlements.maxConcurrentJobs,
			`Plan limit reached: ${input.entitlements.maxConcurrentJobs} concurrent job(s).`,
			{ usage: active }
		);
	}
}

export function assertCountEntitlement(input: {
	code: string;
	limit: number;
	usage: number;
	label: string;
}): void {
	if (input.usage >= input.limit) {
		throw new EntitlementError(
			input.code,
			input.limit,
			`Plan limit reached: ${input.limit} ${input.label}.`,
			{ usage: input.usage }
		);
	}
}
