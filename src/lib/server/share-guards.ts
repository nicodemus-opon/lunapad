import { can, userFromLocals } from './permissions';

type Locals = App.Locals;

export type GuardFailure = { error: string; status: number };

export function requireAuth(locals: Locals): GuardFailure | null {
	if (!locals.user) return { error: 'Unauthorized', status: 401 };
	return null;
}

export function requireSharesPublish(locals: Locals): GuardFailure | null {
	const auth = requireAuth(locals);
	if (auth) return auth;
	if (!can(userFromLocals(locals.user), 'shares:publish')) {
		return { error: 'Forbidden', status: 403 };
	}
	return null;
}

export function requireSharesRead(locals: Locals): GuardFailure | null {
	const auth = requireAuth(locals);
	if (auth) return auth;
	if (!can(userFromLocals(locals.user), 'shares:read')) {
		return { error: 'Forbidden', status: 403 };
	}
	return null;
}

export function requireSitesManage(locals: Locals): GuardFailure | null {
	const auth = requireAuth(locals);
	if (auth) return auth;
	if (!can(userFromLocals(locals.user), 'sites:manage')) {
		return { error: 'Forbidden', status: 403 };
	}
	return null;
}
