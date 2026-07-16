// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { auth } from '$lib/server/auth';
import type {
	Entitlements,
	Organization,
	OrganizationMembership,
	Project
} from '$lib/server/tenancy';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: typeof auth.$Infer.Session.user | null;
			session: typeof auth.$Infer.Session.session | null;
			apiKeyId: string | null;
			apiKeyScopes: string[] | null;
			requestId: string;
			organization: Organization | null;
			project: Project | null;
			membership: OrganizationMembership | null;
			entitlements: Entitlements | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
