import crypto from 'node:crypto';
import { z } from 'zod';
import type { ZodRawShape } from 'zod';
import type { PermissionAction, PermissionUser } from './permissions.js';
import { can, hasApiScope } from './permissions.js';
import {
	listConnectionsAction,
	runQueryAction,
	runPrqlAction,
	listNotebooksAction,
	getNotebookAction,
	dbtRunAction,
	dbtCompileAction,
	getDbtJobStatusAction,
	getDbtManifestAction,
	listSharesAction,
	publishNotebookAction,
	createSitePageAction,
	createNotebookAction,
	patchNotebookAction,
	validateNotebookAction,
	inspectNotebookAction,
	runNotebookCellsAction,
	setChartAction,
	pickChartAction,
	deleteNotebookAction,
	resolveProjectFolder
} from './lunapad-actions.js';
import { getConnectionMetadata } from './connections-store.js';
import { getSecret } from './connection-secrets.js';
import { fetchExternalConnectionSchema } from './connections.js';
import { VISUAL_REPORT_GRAMMAR } from './visual-report-grammar.js';
import { getComponentCapabilityCatalog } from '$lib/services/component-capabilities.js';
import {
	getNotebookAppGrammar,
	planNotebookApp,
	repairNotebookBlueprint,
	scoreNotebookBlueprint
} from '$lib/services/notebook-app-planner.js';
import type { NotebookBlueprint } from '$lib/services/notebook-blueprint.js';
import type { ChartConfig } from '$lib/types/gui-pipeline.js';
import {
	createNotebookShape,
	applyNotebookPatchShape,
	inspectNotebookShape,
	validateNotebookShape,
	runNotebookCellsShape,
	pickChartShape,
	setChartShape
} from '$lib/agent/tools/notebook-tool-schemas.js';
import type { Entitlements, TenantRef } from './tenancy.js';
import { getCloudExecutionAdapter } from './cloud-execution.js';
import type { CloudJobKind } from './cloud-jobs.js';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface AgentDiagnostic {
	code: string;
	severity: DiagnosticSeverity;
	path?: string;
	message: string;
	hint?: string;
	resourceRef?: string;
}

export interface ActionMeta {
	requestId: string;
	action: string;
	resourceRef?: string;
	finalResourceRef?: string;
	timingMs: number;
	idempotencyKey?: string;
	idempotencyReplay?: boolean;
	dryRun?: boolean;
}

export interface ActionEnvelope<T = unknown> {
	ok: boolean;
	data?: T;
	diagnostics: AgentDiagnostic[];
	meta: ActionMeta;
}

export interface AgentAuthContext {
	user: PermissionUser | null;
	apiKeyId: string | null;
	apiKeyScopes: string[] | null;
	tenant?: TenantRef | null;
	entitlements?: Entitlements | null;
}

export interface ActionContext {
	auth: AgentAuthContext;
	requestId: string;
	dryRun: boolean;
	idempotencyKey?: string;
	tenant?: TenantRef | null;
	canRunPython: boolean;
}

export interface AgentActionDefinition {
	name: string;
	description: string;
	permission: PermissionAction;
	mutates: boolean;
	inputSchema: ZodRawShape;
	examples?: unknown[];
	handler: (input: Record<string, unknown>, ctx: ActionContext) => Promise<unknown>;
	dryRun?: (input: Record<string, unknown>, ctx: ActionContext) => Promise<unknown>;
}

const idempotencyCache = new Map<string, ActionEnvelope>();

function requestId(): string {
	return crypto.randomUUID();
}

function resourceRef(kind: string, id: string): string {
	return `${kind}:${id}`;
}

function notebookRef(id: string): string {
	return resourceRef('notebook', id);
}

function cellRef(notebookId: string, cellId: string): string {
	return `cell:${notebookId}#${cellId}`;
}

function outputRef(notebookId: string, outputName: string): string {
	return `output:${notebookId}#${outputName}`;
}

function diagnosticsFrom(raw: unknown, fallbackCode = 'ACTION_DIAGNOSTIC'): AgentDiagnostic[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((d) => {
		const item = d as {
			code?: string;
			severity?: DiagnosticSeverity;
			path?: string;
			message?: string;
			hint?: string;
			resourceRef?: string;
		};
		return {
			code: item.code ?? fallbackCode,
			severity: item.severity ?? 'error',
			path: item.path,
			message: item.message ?? String(d),
			hint: item.hint,
			resourceRef: item.resourceRef
		};
	});
}

function withoutDiagnostics(payload: Record<string, unknown>): Record<string, unknown> {
	const { diagnostics: _diagnostics, ok: _ok, ...rest } = payload;
	return rest;
}

function inferFinalResourceRef(
	action: string,
	input: Record<string, unknown>,
	payload: unknown
): string | undefined {
	if (payload && typeof payload === 'object') {
		const p = payload as {
			notebook?: { id?: string };
			token?: string;
			jobId?: string;
			pageId?: number;
			deletedResourceRef?: string;
		};
		if (p.deletedResourceRef) return p.deletedResourceRef;
		if (p.notebook?.id) return notebookRef(p.notebook.id);
		if (p.token) return resourceRef('share', p.token);
		if (p.jobId) return resourceRef('dbt-job', p.jobId);
		if (p.pageId !== undefined) return resourceRef('site-page', String(p.pageId));
	}
	if (typeof input.notebookId === 'string') return notebookRef(input.notebookId);
	if (typeof input.connectionId === 'string') return resourceRef('connection', input.connectionId);
	if (action === 'delete_resource' && typeof input.resourceRef === 'string')
		return input.resourceRef;
	return undefined;
}

function envelope(
	action: string,
	started: number,
	input: Record<string, unknown>,
	payload: unknown,
	opts: {
		requestId: string;
		idempotencyKey?: string;
		dryRun?: boolean;
		idempotencyReplay?: boolean;
	} = { requestId: requestId() }
): ActionEnvelope {
	const record =
		payload && typeof payload === 'object' && !Array.isArray(payload)
			? (payload as Record<string, unknown>)
			: { value: payload };
	const diagnostics = diagnosticsFrom(record.diagnostics);
	const explicitOk = typeof record.ok === 'boolean' ? record.ok : undefined;
	const ok = explicitOk ?? diagnostics.length === 0;
	const data = withoutDiagnostics(record);
	const finalResourceRef = inferFinalResourceRef(action, input, payload);
	return {
		ok,
		data,
		diagnostics,
		meta: {
			requestId: opts.requestId,
			action,
			resourceRef: typeof input.resourceRef === 'string' ? input.resourceRef : undefined,
			finalResourceRef,
			timingMs: Date.now() - started,
			idempotencyKey: opts.idempotencyKey,
			idempotencyReplay: opts.idempotencyReplay,
			dryRun: opts.dryRun
		}
	};
}

function failureEnvelope(
	action: string,
	started: number,
	input: Record<string, unknown>,
	requestIdValue: string,
	diagnostics: AgentDiagnostic[],
	status?: { dryRun?: boolean; idempotencyKey?: string }
): ActionEnvelope {
	return {
		ok: false,
		diagnostics,
		meta: {
			requestId: requestIdValue,
			action,
			resourceRef: typeof input.resourceRef === 'string' ? input.resourceRef : undefined,
			finalResourceRef: inferFinalResourceRef(action, input, undefined),
			timingMs: Date.now() - started,
			dryRun: status?.dryRun,
			idempotencyKey: status?.idempotencyKey
		}
	};
}

function forbiddenDiagnostic(action: string, permission: PermissionAction): AgentDiagnostic {
	return {
		code: 'FORBIDDEN',
		severity: 'error',
		path: 'auth',
		message: `Forbidden: action "${action}" requires "${permission}".`,
		hint: 'Use an API key whose owner role and scopes allow this action.'
	};
}

function jobKindForAction(def: AgentActionDefinition): CloudJobKind {
	if (def.permission.startsWith('dbt:')) return 'dbt';
	if (def.permission.startsWith('ai:')) return 'ai';
	if (def.name.includes('publish') || def.name.includes('share')) return 'share_refresh';
	if (def.name.includes('run')) return 'notebook_execution';
	return 'notebook_execution';
}

function checkPermission(
	def: AgentActionDefinition,
	auth: AgentAuthContext
): AgentDiagnostic | null {
	if (!can(auth.user, def.permission)) return forbiddenDiagnostic(def.name, def.permission);
	if (auth.apiKeyId && !hasApiScope(auth.apiKeyScopes, def.permission)) {
		return forbiddenDiagnostic(def.name, def.permission);
	}
	return null;
}

const emptyShape = {};
const folderShape = { folder: z.string().optional() };
const notebookIdShape = { folder: z.string().optional(), notebookId: z.string() };
const notebookBlueprintShape = z
	.record(z.string(), z.unknown())
	.describe('Notebook blueprint object. Deep validation and repair happen in the compiler.');
const workflowStepShape = z.object({
	id: z.string(),
	action: z.string(),
	input: z.record(z.string(), z.unknown()).optional(),
	dependsOn: z.array(z.string()).optional()
});

function normalizePagination<T>(
	items: T[],
	limit?: unknown,
	offset?: unknown
): { items: T[]; total: number; limit: number; offset: number } {
	const normalizedOffset = Math.max(0, Number(offset ?? 0) || 0);
	const normalizedLimit = Math.min(500, Math.max(1, Number(limit ?? 100) || 100));
	return {
		items: items.slice(normalizedOffset, normalizedOffset + normalizedLimit),
		total: items.length,
		limit: normalizedLimit,
		offset: normalizedOffset
	};
}

async function discoverSchema(input: Record<string, unknown>, ctx: ActionContext) {
	const connectionId = String(input.connectionId ?? '');
	const connection = await getConnectionMetadata(connectionId, ctx.auth.tenant?.orgId);
	if (!connection) {
		return {
			diagnostics: [
				{
					path: 'connectionId',
					message: `Unknown connection id "${connectionId}".`
				}
			]
		};
	}
	if (connection.type === 'duckdb-wasm') {
		return {
			diagnostics: [
				{
					path: 'connectionId',
					message:
						'The built-in DuckDB-WASM connection is browser-only and cannot be introspected headlessly.'
				}
			]
		};
	}
	const secret = await getSecret(connection.id, ctx.auth.tenant?.orgId);
	const result = await fetchExternalConnectionSchema(
		connection,
		secret ?? undefined,
		ctx.auth.tenant?.orgId
	);
	const schemaFilter = typeof input.schema === 'string' ? input.schema.toLowerCase() : null;
	const tableFilter = typeof input.table === 'string' ? input.table.toLowerCase() : null;
	const tables = result.tables
		.map((table) => ({
			...table,
			relationName: table.schema ? `${table.schema}.${table.name}` : table.name,
			resourceRef: `connection:${connection.id}#${table.schema ? `${table.schema}.` : ''}${table.name}`
		}))
		.filter((table) => !schemaFilter || table.schema?.toLowerCase() === schemaFilter)
		.filter(
			(table) =>
				!tableFilter ||
				table.name.toLowerCase().includes(tableFilter) ||
				table.relationName.toLowerCase().includes(tableFilter)
		);
	const page = normalizePagination(tables, input.limit, input.offset);
	return { connectionId: connection.id, ...page, tables: page.items };
}

function parseResourceRef(ref: string): { type: string; id: string; fragment?: string } {
	const [type, rest = ''] = ref.split(':', 2);
	const [id, fragment] = rest.split('#', 2);
	return { type, id, fragment };
}

async function inspectResource(input: Record<string, unknown>, ctx: ActionContext) {
	const ref = String(input.resourceRef ?? '');
	const parsed = parseResourceRef(ref);
	if (parsed.type === 'connection') {
		const connection = await getConnectionMetadata(parsed.id, ctx.auth.tenant?.orgId);
		if (!connection)
			return {
				diagnostics: [{ path: 'resourceRef', message: `Connection "${parsed.id}" not found.` }]
			};
		return { resourceRef: ref, connection };
	}
	if (parsed.type === 'notebook') {
		const notebook = await inspectNotebookAction({
			tenant: ctx.auth.tenant,
			folder: input.folder as string | undefined,
			notebookId: parsed.id
		});
		return { resourceRef: ref, ...notebook };
	}
	if (parsed.type === 'cell' || parsed.type === 'output') {
		const notebook = await inspectNotebookAction({
			tenant: ctx.auth.tenant,
			folder: input.folder as string | undefined,
			notebookId: parsed.id
		});
		const cell = notebook.cells.find((c) =>
			parsed.type === 'cell' ? c.id === parsed.fragment : c.outputName === parsed.fragment
		);
		if (!cell)
			return { diagnostics: [{ path: 'resourceRef', message: `Resource "${ref}" not found.` }] };
		return { resourceRef: ref, cell };
	}
	if (parsed.type === 'dbt-job') {
		return { resourceRef: ref, ...(await getDbtJobStatusAction({ jobId: parsed.id })) };
	}
	return { diagnostics: [{ path: 'resourceRef', message: `Unsupported resource ref "${ref}".` }] };
}

async function deleteResource(input: Record<string, unknown>, ctx: ActionContext) {
	const ref = String(input.resourceRef ?? '');
	const parsed = parseResourceRef(ref);
	if (parsed.type !== 'notebook') {
		return {
			diagnostics: [
				{
					path: 'resourceRef',
					message: 'delete_resource currently supports only notebook:<notebookId> refs.'
				}
			]
		};
	}
	const result = await deleteNotebookAction({
		tenant: ctx.auth.tenant,
		folder: input.folder as string | undefined,
		notebookId: parsed.id
	});
	return { ...result, deletedResourceRef: ref };
}

function capabilities() {
	const componentCatalog = getComponentCapabilityCatalog();
	return {
		actions: ACTIONS.map((action) => ({
			name: action.name,
			description: action.description,
			permission: action.permission,
			mutates: action.mutates,
			inputSchemaKeys: Object.keys(action.inputSchema),
			examples: action.examples ?? []
		})),
		resourceRefs: [
			'connection:<id>',
			'notebook:<notebookId>',
			'cell:<notebookId>#<cellId>',
			'output:<notebookId>#<outputName>',
			'dbt-job:<id>',
			'share:<token>',
			'site:<id>'
		],
		recipes: [
			'get_component_capabilities -> plan_notebook_app -> repair_notebook_blueprint -> create_notebook -> validate_notebook',
			'get_notebook_app_grammar -> discover_schema -> create_notebook -> run_cells -> validate_notebook',
			'get_visual_report_grammar -> discover_schema -> create_notebook -> run_cells -> validate_notebook',
			'discover_schema -> create_notebook -> run_cells -> validate_notebook',
			'inspect_resource -> apply_notebook_patch -> run_workflow',
			'validate_workflow(dryRun) -> run_workflow'
		],
		componentCapabilities: {
			action: 'get_component_capabilities',
			version: componentCatalog.version,
			hash: componentCatalog.hash,
			aiAuthorableComponents: componentCatalog.aiAuthorableComponentIds,
			count: componentCatalog.components.length
		},
		notebookAppGrammar: {
			action: 'get_notebook_app_grammar',
			planner: 'plan_notebook_app',
			mutationTools: ['create_notebook', 'apply_notebook_patch', 'validate_notebook'],
			helperTools: [
				'get_component_capabilities',
				'get_notebook_app_grammar',
				'plan_notebook_app',
				'repair_notebook_blueprint',
				'score_notebook_blueprint'
			]
		},
		visualReportGrammar: {
			action: 'get_visual_report_grammar',
			purpose: VISUAL_REPORT_GRAMMAR.purpose,
			blockTypes: VISUAL_REPORT_GRAMMAR.blockTypes,
			chartTypes: VISUAL_REPORT_GRAMMAR.chartTypes,
			dataRoles: VISUAL_REPORT_GRAMMAR.dataRoles.map(({ name, useFor, blocks }) => ({
				name,
				useFor,
				blocks
			})),
			compositionPatterns: VISUAL_REPORT_GRAMMAR.compositionPatterns.map(
				({ name, useFor, blocks }) => ({
					name,
					useFor,
					blocks
				})
			),
			styleAxes: VISUAL_REPORT_GRAMMAR.styleAxes.map(({ name, values }) => ({ name, values })),
			examples: VISUAL_REPORT_GRAMMAR.blueprintExamples.map(({ name, description }) => ({
				name,
				description
			}))
		}
	};
}

async function runWorkflow(input: Record<string, unknown>, ctx: ActionContext, dryRun: boolean) {
	const steps = (input.steps ?? []) as Array<{
		id: string;
		action: string;
		input?: Record<string, unknown>;
		dependsOn?: string[];
	}>;
	const stopOnError = input.stopOnError !== false;
	const outputs = new Map<string, ActionEnvelope>();
	const skipped: Array<{ id: string; reason: string }> = [];
	const stepResults: Array<{ id: string; action: string; result: ActionEnvelope }> = [];

	for (const step of steps) {
		const blockedBy = (step.dependsOn ?? []).find((id) => !outputs.get(id)?.ok);
		if (blockedBy) {
			skipped.push({
				id: step.id,
				reason: `Dependency "${blockedBy}" did not complete successfully.`
			});
			if (stopOnError) continue;
		}
		const resolvedInput = resolveStepRefs(step.input ?? {}, outputs) as Record<string, unknown>;
		const result = await executeAgentAction(step.action, resolvedInput, ctx.auth, {
			requestId: ctx.requestId,
			dryRun: dryRun || ctx.dryRun
		});
		outputs.set(step.id, result);
		stepResults.push({ id: step.id, action: step.action, result });
		if (!result.ok && stopOnError) {
			for (const later of steps.slice(steps.indexOf(step) + 1)) {
				if ((later.dependsOn ?? []).includes(step.id)) {
					skipped.push({ id: later.id, reason: `Dependency "${step.id}" failed.` });
				}
			}
		}
	}

	return {
		steps: stepResults,
		skipped,
		diagnostics: stepResults.flatMap((step) =>
			step.result.ok
				? []
				: step.result.diagnostics.map((d) => ({ ...d, path: `${step.id}.${d.path ?? ''}` }))
		)
	};
}

function resolveStepRefs(value: unknown, outputs: Map<string, ActionEnvelope>): unknown {
	if (Array.isArray(value)) return value.map((item) => resolveStepRefs(item, outputs));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				resolveStepRefs(item, outputs)
			])
		);
	}
	if (typeof value !== 'string' || !value.startsWith('$steps.')) return value;
	const parts = value.slice('$steps.'.length).split('.');
	const stepId = parts.shift();
	if (!stepId) return value;
	let current: unknown = outputs.get(stepId);
	for (const part of parts) {
		if (!current || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

export const ACTIONS: AgentActionDefinition[] = [
	{
		name: 'list_capabilities',
		description:
			'List agent API capabilities, resource ref formats, workflow recipes, and visual report grammar metadata.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: emptyShape,
		handler: async () => capabilities()
	},
	{
		name: 'get_visual_report_grammar',
		description:
			'Return the typed notebook blueprint grammar for dense infographic reports, poster-style dashboards, and website-like analytical reports.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: emptyShape,
		examples: [
			{
				pattern: 'editorial_infographic_page',
				next: 'Use create_notebook with executableCells plus columns/grid/metric/chart blocks.'
			},
			{
				pattern: 'website_like_story',
				next: 'Use text, columns, card, chart, tabs, embed, and bookmark blocks for a shareable report.'
			}
		],
		handler: async () => VISUAL_REPORT_GRAMMAR
	},
	{
		name: 'get_component_capabilities',
		description:
			'Return the self-describing AI-authorable component registry shared by prompts, planner, editor, validation, and MCP clients.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: emptyShape,
		handler: async () => getComponentCapabilityCatalog()
	},
	{
		name: 'get_notebook_app_grammar',
		description:
			'Return the generic data-app-to-notebook grammar: intent fields, primitive view skeletons, fail-soft diagnostics, and component capabilities.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: emptyShape,
		handler: async () => getNotebookAppGrammar()
	},
	{
		name: 'plan_notebook_app',
		description:
			'Plan a general data app as notebook IR primitives using the component capability registry; labels such as dashboard or infographic are hints, not separate creation tools.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: {
			prompt: z.string(),
			availableOutputNames: z.array(z.string()).optional()
		},
		handler: async (input) =>
			planNotebookApp({
				prompt: String(input.prompt),
				availableOutputNames: input.availableOutputNames as string[] | undefined
			})
	},
	{
		name: 'repair_notebook_blueprint',
		description:
			'Run deterministic fail-soft repair on a notebook blueprint without mutating files; repairable/downgradable fixes are returned with a repair log.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: {
			blueprint: notebookBlueprintShape,
			autoRepair: z.enum(['off', 'safe', 'aggressive']).optional(),
			knownRefs: z.array(z.string()).optional()
		},
		handler: async (input) => ({
			result: repairNotebookBlueprint(input.blueprint as NotebookBlueprint, {
				autoRepair: input.autoRepair as 'off' | 'safe' | 'aggressive' | undefined,
				knownRefs: input.knownRefs as string[] | undefined
			})
		})
	},
	{
		name: 'score_notebook_blueprint',
		description:
			'Score a notebook blueprint for validity, layout, interaction, data-view coverage, recovery, and narrative usefulness without mutating files.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: {
			blueprint: notebookBlueprintShape,
			target: z.enum(['valid', 'polished', 'publication']).optional(),
			autoRepair: z.enum(['off', 'safe', 'aggressive']).optional(),
			knownRefs: z.array(z.string()).optional()
		},
		handler: async (input) => ({
			result: scoreNotebookBlueprint(input.blueprint as NotebookBlueprint, {
				target: input.target as 'valid' | 'polished' | 'publication' | undefined,
				autoRepair: input.autoRepair as 'off' | 'safe' | 'aggressive' | undefined,
				knownRefs: input.knownRefs as string[] | undefined
			})
		})
	},
	{
		name: 'list_connections',
		description: 'List configured external connections.',
		permission: 'connections:query',
		mutates: false,
		inputSchema: emptyShape,
		handler: async (_input, ctx) => listConnectionsAction(ctx.auth.tenant)
	},
	{
		name: 'discover_schema',
		description:
			'Discover tables, columns, types, descriptions, and foreign-key hints for a connection.',
		permission: 'connections:query',
		mutates: false,
		inputSchema: {
			connectionId: z.string(),
			schema: z.string().optional(),
			table: z.string().optional(),
			limit: z.number().optional(),
			offset: z.number().optional()
		},
		handler: discoverSchema
	},
	{
		name: 'run_query',
		description: 'Run read-only SQL against an external connection.',
		permission: 'connections:query',
		mutates: false,
		inputSchema: { connectionId: z.string(), sql: z.string() },
		handler: async (input, ctx) =>
			runQueryAction({
				tenant: ctx.auth.tenant,
				connectionId: String(input.connectionId),
				sql: String(input.sql)
			})
	},
	{
		name: 'run_prql',
		description: 'Compile PRQL and run it against an external connection.',
		permission: 'connections:query',
		mutates: false,
		inputSchema: { connectionId: z.string(), prql: z.string() },
		handler: async (input, ctx) =>
			runPrqlAction({
				tenant: ctx.auth.tenant,
				connectionId: String(input.connectionId),
				prql: String(input.prql)
			})
	},
	{
		name: 'list_notebooks',
		description: 'List project-folder-backed notebooks.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: folderShape,
		handler: async (input, ctx) =>
			listNotebooksAction({ tenant: ctx.auth.tenant, folder: input.folder as string | undefined })
	},
	{
		name: 'get_notebook',
		description: 'Get one project-folder-backed notebook.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: notebookIdShape,
		handler: async (input, ctx) =>
			getNotebookAction({
				tenant: ctx.auth.tenant,
				folder: input.folder as string | undefined,
				notebookId: String(input.notebookId)
			})
	},
	{
		name: 'inspect_resource',
		description:
			'Inspect a resource ref such as notebook:<id>, cell:<notebook>#<cellId>, or connection:<id>.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: { folder: z.string().optional(), resourceRef: z.string() },
		handler: inspectResource
	},
	{
		name: 'inspect_notebook',
		description: 'Inspect a notebook document and cells.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: inspectNotebookShape,
		handler: async (input, ctx) =>
			inspectNotebookAction({
				tenant: ctx.auth.tenant,
				folder: input.folder as string | undefined,
				notebookId: String(input.notebookId)
			})
	},
	{
		name: 'create_notebook',
		description:
			'Create a .luna notebook from a typed blueprint, including dense infographic/poster/microsite-like analytical reports.',
		permission: 'workspace:write',
		mutates: true,
		inputSchema: createNotebookShape,
		examples: VISUAL_REPORT_GRAMMAR.blueprintExamples.map(({ name, description, blueprint }) => ({
			name,
			description,
			input: { notebookId: `reports/${name}`, ...blueprint }
		})),
		handler: async (input, ctx) =>
			createNotebookAction({
				...(input as Record<string, unknown>),
				tenant: ctx.auth.tenant
			} as never),
		dryRun: async (input) => ({ dryRun: true, wouldCreate: notebookRef(String(input.notebookId)) })
	},
	{
		name: 'apply_notebook_patch',
		description:
			'Patch an existing .luna notebook, including whole-document visual report blueprint replacements or surgical node operations.',
		permission: 'workspace:write',
		mutates: true,
		inputSchema: applyNotebookPatchShape,
		handler: async (input, ctx) =>
			patchNotebookAction({
				...(input as Record<string, unknown>),
				tenant: ctx.auth.tenant
			} as never),
		dryRun: async (input) => ({ dryRun: true, wouldPatch: notebookRef(String(input.notebookId)) })
	},
	{
		name: 'validate_notebook',
		description: 'Validate a notebook document.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: validateNotebookShape,
		handler: async (input, ctx) =>
			validateNotebookAction({
				tenant: ctx.auth.tenant,
				folder: input.folder as string | undefined,
				notebookId: String(input.notebookId)
			})
	},
	{
		name: 'run_query_nodes',
		description: 'Run notebook cells by cellId/outputName, or all executable cells when omitted.',
		permission: 'workspace:write',
		mutates: true,
		inputSchema: runNotebookCellsShape,
		handler: async (input, ctx) =>
			runNotebookCellsAction({
				tenant: ctx.auth.tenant,
				folder: input.folder as string | undefined,
				notebookId: String(input.notebookId),
				cellIds: input.cellIds as string[] | undefined,
				allowPython: ctx.canRunPython
			}),
		dryRun: async (input) => ({
			dryRun: true,
			wouldRun: notebookRef(String(input.notebookId)),
			cellIds: input.cellIds ?? null
		})
	},
	{
		name: 'run_cells',
		description: 'Alias of run_query_nodes.',
		permission: 'workspace:write',
		mutates: true,
		inputSchema: runNotebookCellsShape,
		handler: async (input, ctx) =>
			runNotebookCellsAction({
				tenant: ctx.auth.tenant,
				folder: input.folder as string | undefined,
				notebookId: String(input.notebookId),
				cellIds: input.cellIds as string[] | undefined,
				allowPython: ctx.canRunPython
			}),
		dryRun: async (input) => ({
			dryRun: true,
			wouldRun: notebookRef(String(input.notebookId)),
			cellIds: input.cellIds ?? null
		})
	},
	{
		name: 'pick_chart',
		description: 'Run a cell and choose a reasonable chart config.',
		permission: 'workspace:write',
		mutates: true,
		inputSchema: pickChartShape,
		handler: async (input, ctx) =>
			pickChartAction({
				tenant: ctx.auth.tenant,
				folder: input.folder as string | undefined,
				notebookId: String(input.notebookId),
				cellId: String(input.cellId)
			})
	},
	{
		name: 'set_chart',
		description: 'Set or clear a cell chart config.',
		permission: 'workspace:write',
		mutates: true,
		inputSchema: setChartShape,
		handler: async (input, ctx) =>
			setChartAction({
				tenant: ctx.auth.tenant,
				folder: input.folder as string | undefined,
				notebookId: String(input.notebookId),
				cellId: String(input.cellId),
				chartConfig: input.chartConfig as ChartConfig | null
			})
	},
	{
		name: 'delete_resource',
		description:
			'Delete supported resources. Currently supports notebook:<notebookId> for .luna notebooks.',
		permission: 'workspace:write',
		mutates: true,
		inputSchema: { folder: z.string().optional(), resourceRef: z.string() },
		handler: async (input, ctx) => deleteResource(input, ctx),
		dryRun: async (input) => ({ dryRun: true, wouldDelete: input.resourceRef })
	},
	{
		name: 'dbt_run',
		description: 'Run dbt run in a project folder.',
		permission: 'dbt:run',
		mutates: true,
		inputSchema: { folder: z.string().optional(), select: z.string().optional() },
		handler: async (input, ctx) =>
			dbtRunAction({
				tenant: ctx.auth.tenant,
				folder: input.folder as string | undefined,
				select: input.select as string | undefined
			})
	},
	{
		name: 'dbt_compile',
		description: 'Run dbt compile in a project folder.',
		permission: 'dbt:run',
		mutates: true,
		inputSchema: folderShape,
		handler: async (input, ctx) =>
			dbtCompileAction({ tenant: ctx.auth.tenant, folder: input.folder as string | undefined })
	},
	{
		name: 'get_dbt_job_status',
		description: 'Poll a dbt job status.',
		permission: 'dbt:read',
		mutates: false,
		inputSchema: { jobId: z.string() },
		handler: async (input) => getDbtJobStatusAction({ jobId: String(input.jobId) })
	},
	{
		name: 'get_dbt_manifest',
		description: 'Get a dbt manifest.',
		permission: 'dbt:read',
		mutates: false,
		inputSchema: folderShape,
		handler: async (input, ctx) =>
			getDbtManifestAction({ tenant: ctx.auth.tenant, folder: input.folder as string | undefined })
	},
	{
		name: 'list_shares',
		description: 'List active published shares.',
		permission: 'shares:read',
		mutates: false,
		inputSchema: emptyShape,
		handler: async (_input, ctx) => listSharesAction(ctx.auth.tenant)
	},
	{
		name: 'publish_notebook',
		description: 'Publish a notebook as a share.',
		permission: 'shares:publish',
		mutates: true,
		inputSchema: { notebookId: z.string() },
		handler: async (input, ctx) =>
			publishNotebookAction({ tenant: ctx.auth.tenant, notebookId: String(input.notebookId) })
	},
	{
		name: 'create_site_page',
		description: 'Add a published share as a page on a site.',
		permission: 'sites:manage',
		mutates: true,
		inputSchema: {
			siteId: z.string(),
			pageSlug: z.string(),
			navLabel: z.string(),
			shareToken: z.string()
		},
		handler: async (input, ctx) =>
			createSitePageAction({
				tenant: ctx.auth.tenant,
				siteId: String(input.siteId),
				pageSlug: String(input.pageSlug),
				navLabel: String(input.navLabel),
				shareToken: String(input.shareToken)
			})
	},
	{
		name: 'validate_workflow',
		description: 'Validate a workflow and dry-run mutating steps.',
		permission: 'workspace:read',
		mutates: false,
		inputSchema: { steps: z.array(workflowStepShape), stopOnError: z.boolean().optional() },
		handler: async (input, ctx) => runWorkflow(input, ctx, true)
	},
	{
		name: 'run_workflow',
		description: 'Run ordered agent actions with step refs and per-step envelopes.',
		permission: 'workspace:write',
		mutates: true,
		inputSchema: { steps: z.array(workflowStepShape), stopOnError: z.boolean().optional() },
		handler: async (input, ctx) => runWorkflow(input, ctx, false),
		dryRun: async (input, ctx) => runWorkflow(input, ctx, true)
	}
];

const ACTION_BY_NAME = new Map(ACTIONS.map((action) => [action.name, action]));

export function getAgentAction(name: string): AgentActionDefinition | undefined {
	return ACTION_BY_NAME.get(name);
}

export function listAgentActions(): AgentActionDefinition[] {
	return ACTIONS;
}

export function createActionContext(
	auth: AgentAuthContext,
	opts: { requestId?: string; dryRun?: boolean; idempotencyKey?: string } = {}
): ActionContext {
	return {
		auth,
		requestId: opts.requestId ?? requestId(),
		dryRun: opts.dryRun ?? false,
		idempotencyKey: opts.idempotencyKey,
		tenant: auth.tenant,
		canRunPython:
			can(auth.user, 'admin:manage') &&
			(!auth.apiKeyId || hasApiScope(auth.apiKeyScopes, 'admin:manage'))
	};
}

export async function executeAgentAction(
	name: string,
	rawInput: Record<string, unknown>,
	auth: AgentAuthContext,
	opts: { requestId?: string; dryRun?: boolean; idempotencyKey?: string } = {}
): Promise<ActionEnvelope> {
	const started = Date.now();
	const reqId = opts.requestId ?? requestId();
	const def = getAgentAction(name);
	if (!def) {
		return failureEnvelope(name, started, rawInput, reqId, [
			{
				code: 'UNKNOWN_ACTION',
				severity: 'error',
				path: 'action',
				message: `Unknown action "${name}".`
			}
		]);
	}
	const denied = checkPermission(def, auth);
	if (denied) return failureEnvelope(name, started, rawInput, reqId, [denied]);

	const parsed = z.object(def.inputSchema).safeParse(rawInput);
	if (!parsed.success) {
		return failureEnvelope(name, started, rawInput, reqId, [
			{
				code: 'INVALID_INPUT',
				severity: 'error',
				path: 'input',
				message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
			}
		]);
	}

	const idempotencyKey = opts.idempotencyKey;
	const cacheKey = idempotencyKey && def.mutates ? `${name}:${idempotencyKey}` : null;
	if (cacheKey && idempotencyCache.has(cacheKey)) {
		const cached = idempotencyCache.get(cacheKey)!;
		return { ...cached, meta: { ...cached.meta, requestId: reqId, idempotencyReplay: true } };
	}

	const ctx = createActionContext(auth, { requestId: reqId, dryRun: opts.dryRun, idempotencyKey });
	const payload =
		opts.dryRun && def.mutates
			? def.dryRun
				? await def.dryRun(parsed.data, ctx)
				: { dryRun: true, wouldRun: name }
			: def.mutates && auth.tenant
				? await getCloudExecutionAdapter()
						.submit({
							tenant: auth.tenant,
							userId: auth.user?.id,
							kind: jobKindForAction(def),
							timeoutMs: 180_000,
							quotaKey: `agent:${name}`,
							requestId: reqId,
							entitlements: auth.entitlements,
							payload: { action: name, input: parsed.data },
							run: async () => def.handler(parsed.data, ctx)
						})
						.then((execution) =>
							execution.queued ? { queued: true, job: execution.job } : execution.result
						)
				: await def.handler(parsed.data, ctx);
	const result = envelope(name, started, parsed.data, payload, {
		requestId: reqId,
		idempotencyKey,
		dryRun: opts.dryRun
	});
	if (
		cacheKey &&
		result.ok &&
		!(result.data && typeof result.data === 'object' && 'queued' in result.data)
	) {
		idempotencyCache.set(cacheKey, result);
	}
	return result;
}

export function executeAgentActionOrThrow(
	name: string,
	rawInput: Record<string, unknown>,
	auth: AgentAuthContext,
	opts: { requestId?: string; dryRun?: boolean; idempotencyKey?: string } = {}
): Promise<ActionEnvelope> {
	return executeAgentAction(name, rawInput, auth, opts);
}

export function resourceHelpers() {
	return { resourceRef, notebookRef, cellRef, outputRef, resolveProjectFolder };
}
