import type { CellLanguage, CellType } from '$lib/stores/notebook.svelte';
import type { GeneratedDashboardBlock } from './generated-dashboard';
import {
	getMarkdocPmSchema,
	markdownToPmDocument,
	normalizePmNodeIds,
	pmDocumentToMarkdown,
	type PMDocJSON,
	type PMNodeJSON
} from './markdoc-pm';
import { markdocAttrsToJson } from './markdoc-ast';

export interface NotebookExecutableBlueprint {
	cellId: string;
	outputName: string;
	cellType?: Extract<CellType, 'query' | 'python'>;
	language?: CellLanguage;
	code: string;
}

export type NotebookBlueprintBlock =
	| GeneratedDashboardBlock
	| {
			type: 'queryBlock';
			cellId: string;
			cellType?: Extract<CellType, 'query' | 'python'>;
			pinned?: boolean;
	  };

export interface NotebookBlueprint {
	title?: string;
	executableCells?: NotebookExecutableBlueprint[];
	blocks: NotebookBlueprintBlock[];
}

export interface NotebookBlueprintDiagnostic {
	path: string;
	nodeType?: string;
	attribute?: string;
	invalidValue?: unknown;
	message: string;
}

export interface CompileNotebookBlueprintResult {
	document: PMDocJSON | null;
	executableCells: NotebookExecutableBlueprint[];
	diagnostics: NotebookBlueprintDiagnostic[];
}

export type NotebookPatchOperation =
	| { op: 'replace_document'; document: PMDocJSON }
	| { op: 'insert_node'; parentNodeId?: string; index?: number; node: PMNodeJSON }
	| { op: 'replace_node'; nodeId: string; node: PMNodeJSON }
	| { op: 'delete_node'; nodeId: string }
	| { op: 'patch_attrs'; nodeId: string; attrs: Record<string, unknown> }
	| { op: 'move_node'; nodeId: string; parentNodeId?: string; index: number };

export interface ApplyNotebookPatchResult {
	document: PMDocJSON | null;
	diagnostics: NotebookBlueprintDiagnostic[];
}

const CONTAINER_CHILD_RULES: Record<string, string> = {
	tabs: 'tab',
	columns: 'column'
};

function diagnostic(
	path: string,
	message: string,
	extra: Omit<NotebookBlueprintDiagnostic, 'path' | 'message'> = {}
): NotebookBlueprintDiagnostic {
	return { path, message, ...extra };
}

function paragraph(text = ''): PMNodeJSON {
	return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
}

function textNodesFromMarkdown(markdown: string): PMNodeJSON[] {
	return markdownToPmDocument(markdown).doc.content ?? [paragraph(markdown)];
}

function widget(tagName: string, attrs: Record<string, unknown> = {}): PMNodeJSON {
	return {
		type: 'markdocWidget',
		attrs: {
			tagName,
			attrsJson: markdocAttrsToJson(attrs),
			selfClosing: true
		}
	};
}

function container(
	tagName: string,
	content: PMNodeJSON[],
	attrs: Record<string, unknown> = {}
): PMNodeJSON {
	return {
		type: 'markdocContainer',
		attrs: {
			tagName,
			attrsJson: markdocAttrsToJson(attrs)
		},
		content: content.length ? content : [paragraph()]
	};
}

function scalar(value: unknown): unknown {
	return value;
}

function validateKnownRef(
	value: unknown,
	knownRefs: Set<string>,
	path: string,
	diagnostics: NotebookBlueprintDiagnostic[]
): void {
	if (typeof value !== 'string') return;
	for (const match of value.matchAll(/\$([A-Za-z_]\w*)/g)) {
		const root = match[1];
		if (knownRefs.size > 0 && !knownRefs.has(root)) {
			diagnostics.push(
				diagnostic(path, `Unknown live reference "${root}".`, {
					attribute: 'ref',
					invalidValue: value
				})
			);
		}
	}
}

function attrsFromBlock(
	block: Record<string, unknown>,
	omit: string[] = ['type']
): Record<string, unknown> {
	const attrs: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(block)) {
		if (omit.includes(key) || value === undefined || value === null || value === '') continue;
		attrs[key] = value;
	}
	return attrs;
}

function compileChildren(
	blocks: NotebookBlueprintBlock[] | undefined,
	path: string,
	ctx: CompileContext
): PMNodeJSON[] {
	if (!blocks?.length) return [paragraph()];
	return blocks.flatMap((block, index) => compileBlock(block, `${path}.${index}`, ctx));
}

interface CompileContext {
	queryBlockCellIds: Set<string>;
	knownRefs: Set<string>;
	diagnostics: NotebookBlueprintDiagnostic[];
}

function compileBlock(
	block: NotebookBlueprintBlock,
	path: string,
	ctx: CompileContext
): PMNodeJSON[] {
	if (!block || typeof block !== 'object') {
		ctx.diagnostics.push(diagnostic(path, 'Block must be an object.'));
		return [];
	}

	switch (block.type) {
		case 'queryBlock': {
			if (!block.cellId?.trim()) {
				ctx.diagnostics.push(
					diagnostic(path, 'queryBlock requires cellId.', { nodeType: 'queryBlock' })
				);
				return [];
			}
			if (!ctx.queryBlockCellIds.has(block.cellId)) {
				ctx.diagnostics.push(
					diagnostic(path, `queryBlock references missing executable cell "${block.cellId}".`, {
						nodeType: 'queryBlock',
						attribute: 'cellId',
						invalidValue: block.cellId
					})
				);
			}
			return [
				{
					type: 'queryBlock',
					attrs: {
						cellId: block.cellId,
						cellType: block.cellType ?? 'query',
						pinned: block.pinned ?? true
					}
				}
			];
		}
		case 'text':
			validateKnownRef(block.content, ctx.knownRefs, `${path}.content`, ctx.diagnostics);
			return textNodesFromMarkdown(block.content);
		case 'divider':
			return [{ type: 'horizontalRule' }];
		case 'grid':
			return [
				container(
					'grid',
					compileChildren(block.items as NotebookBlueprintBlock[], `${path}.items`, ctx),
					attrsFromBlock(block, ['type', 'items'])
				)
			];
		case 'columns':
			return [
				container(
					'columns',
					(block.columns ?? []).map((column, index) =>
						container(
							'column',
							compileChildren(
								column.blocks as NotebookBlueprintBlock[],
								`${path}.columns.${index}.blocks`,
								ctx
							),
							attrsFromBlock(column as Record<string, unknown>, ['blocks'])
						)
					),
					attrsFromBlock(block, ['type', 'columns'])
				)
			];
		case 'card':
		case 'callout':
		case 'details':
			return [
				container(
					block.type,
					compileChildren(block.blocks as NotebookBlueprintBlock[], `${path}.blocks`, ctx),
					attrsFromBlock(block, ['type', 'blocks'])
				)
			];
		case 'tabs':
			return [
				container(
					'tabs',
					(block.tabs ?? []).map((tab, index) =>
						container(
							'tab',
							compileChildren(
								tab.blocks as NotebookBlueprintBlock[],
								`${path}.tabs.${index}.blocks`,
								ctx
							),
							{ label: tab.label }
						)
					)
				)
			];
		case 'mermaid': {
			validateKnownRef(block.codeRef, ctx.knownRefs, `${path}.codeRef`, ctx.diagnostics);
			if (block.codeRef) return [container('mermaid', [paragraph()], { code: block.codeRef })];
			return [
				container('mermaid', [
					{
						type: 'codeBlock',
						attrs: { language: 'mermaid' },
						content: block.code ? [{ type: 'text', text: block.code.trim() }] : undefined
					}
				])
			];
		}
		case 'each':
		case 'group':
			validateKnownRef(block.data, ctx.knownRefs, `${path}.data`, ctx.diagnostics);
			return [
				container(
					block.type,
					textNodesFromMarkdown(block.template?.trim() || ' '),
					attrsFromBlock(block, ['type', 'template'])
				)
			];
		case 'conditional': {
			validateKnownRef(block.test.left, ctx.knownRefs, `${path}.test.left`, ctx.diagnostics);
			validateKnownRef(block.test.right, ctx.knownRefs, `${path}.test.right`, ctx.diagnostics);
			const condition = `${block.test.op}(${JSON.stringify(scalar(block.test.left))}, ${JSON.stringify(
				scalar(block.test.right)
			)})`;
			const content = compileChildren(block.then as NotebookBlueprintBlock[], `${path}.then`, ctx);
			if (block.else?.length) {
				content.push(widget('else'));
				content.push(
					...compileChildren(block.else as NotebookBlueprintBlock[], `${path}.else`, ctx)
				);
			}
			return [container('if', content, { condition })];
		}
		case 'metric':
		case 'chart':
		case 'datatable':
		case 'badge':
		case 'progress':
		case 'filter':
		case 'toc':
		case 'math':
		case 'video':
		case 'embed':
		case 'bookmark': {
			for (const value of Object.values(block))
				validateKnownRef(value, ctx.knownRefs, path, ctx.diagnostics);
			return [widget(block.type, attrsFromBlock(block))];
		}
		default:
			ctx.diagnostics.push(
				diagnostic(
					path,
					`Unsupported block type "${String((block as { type?: unknown }).type)}".`,
					{
						invalidValue: (block as { type?: unknown }).type
					}
				)
			);
			return [];
	}
}

function validateContainerRules(
	node: PMNodeJSON,
	path: string,
	diagnostics: NotebookBlueprintDiagnostic[]
): void {
	if (node.type === 'markdocContainer') {
		const tagName = String(node.attrs?.tagName ?? '');
		const requiredChildTag = CONTAINER_CHILD_RULES[tagName];
		const children = node.content ?? [];
		if (!children.length) {
			diagnostics.push(
				diagnostic(path, 'Container must contain at least one block.', { nodeType: tagName })
			);
		}
		if (requiredChildTag) {
			for (let i = 0; i < children.length; i++) {
				const child = children[i]!;
				if (child.type !== 'markdocContainer' || child.attrs?.tagName !== requiredChildTag) {
					diagnostics.push(
						diagnostic(
							`${path}.content.${i}`,
							`${tagName} may only contain ${requiredChildTag} containers.`,
							{ nodeType: child.type, invalidValue: child.attrs?.tagName }
						)
					);
				}
			}
		}
	}
	(node.content ?? []).forEach((child, index) =>
		validateContainerRules(child, `${path}.content.${index}`, diagnostics)
	);
}

export function validateNotebookPmDocument(doc: PMDocJSON): NotebookBlueprintDiagnostic[] {
	const diagnostics: NotebookBlueprintDiagnostic[] = [];
	try {
		getMarkdocPmSchema().nodeFromJSON(doc);
	} catch (error) {
		diagnostics.push(
			diagnostic('doc', error instanceof Error ? error.message : 'Invalid ProseMirror document.')
		);
	}
	(doc.content ?? []).forEach((node, index) =>
		validateContainerRules(node, `doc.content.${index}`, diagnostics)
	);
	try {
		const withoutQueryBlocks: PMDocJSON = {
			type: 'doc',
			content: (doc.content ?? []).filter((node) => node.type !== 'queryBlock')
		};
		markdownToPmDocument(pmDocumentToMarkdown({ frontmatter: '', doc: withoutQueryBlocks }));
	} catch (error) {
		diagnostics.push(
			diagnostic(
				'doc',
				error instanceof Error ? error.message : 'Document failed markdown round-trip parse.'
			)
		);
	}
	return diagnostics;
}

export function compileNotebookBlueprint(
	blueprint: NotebookBlueprint,
	knownRefs: Iterable<string> = [],
	knownCellIds: Iterable<string> = []
): CompileNotebookBlueprintResult {
	const executableCells = blueprint.executableCells ?? [];
	const ctx: CompileContext = {
		queryBlockCellIds: new Set([...knownCellIds, ...executableCells.map((cell) => cell.cellId)]),
		knownRefs: new Set([...knownRefs, ...executableCells.map((cell) => cell.outputName)]),
		diagnostics: []
	};

	const content: PMNodeJSON[] = [];
	if (blueprint.title?.trim()) {
		content.push({
			type: 'heading',
			attrs: { level: 1 },
			content: [{ type: 'text', text: blueprint.title.trim() }]
		});
	}
	content.push(...compileChildren(blueprint.blocks, 'blocks', ctx));
	if (!content.length) content.push(paragraph());

	const document = normalizePmNodeIds({ type: 'doc', content });
	const diagnostics = [...ctx.diagnostics, ...validateNotebookPmDocument(document)];
	return {
		document: diagnostics.length ? null : document,
		executableCells,
		diagnostics
	};
}

function findChildContainer(
	doc: PMDocJSON,
	nodeId: string | undefined,
	diagnostics: NotebookBlueprintDiagnostic[]
): PMDocJSON | PMNodeJSON | null {
	if (!nodeId) return doc;
	const visit = (node: PMDocJSON | PMNodeJSON): PMDocJSON | PMNodeJSON | null => {
		if (node.attrs?.nodeId === nodeId) return node;
		for (const child of node.content ?? []) {
			const found = visit(child);
			if (found) return found;
		}
		return null;
	};
	const found = visit(doc);
	if (!found)
		diagnostics.push(diagnostic('patch', `Node "${nodeId}" not found.`, { invalidValue: nodeId }));
	return found;
}

function removeNode(
	doc: PMDocJSON,
	nodeId: string
): { document: PMDocJSON; removed: PMNodeJSON | null } {
	let removed: PMNodeJSON | null = null;
	const walk = (node: PMDocJSON | PMNodeJSON): PMDocJSON | PMNodeJSON => {
		const content: PMNodeJSON[] = [];
		for (const child of node.content ?? []) {
			if (child.attrs?.nodeId === nodeId) {
				removed = child;
				continue;
			}
			content.push(walk(child) as PMNodeJSON);
		}
		return { ...node, content };
	};
	return { document: walk(doc) as PMDocJSON, removed };
}

function replaceNode(doc: PMDocJSON, nodeId: string, nextNode: PMNodeJSON): PMDocJSON {
	const walk = (node: PMDocJSON | PMNodeJSON): PMDocJSON | PMNodeJSON => ({
		...node,
		content: (node.content ?? []).map((child) =>
			child.attrs?.nodeId === nodeId ? nextNode : (walk(child) as PMNodeJSON)
		)
	});
	return walk(doc) as PMDocJSON;
}

export function applyNotebookPatchOperations(
	document: PMDocJSON,
	operations: NotebookPatchOperation[]
): ApplyNotebookPatchResult {
	const diagnostics: NotebookBlueprintDiagnostic[] = [];
	let next = normalizePmNodeIds(document);

	for (let index = 0; index < operations.length; index++) {
		const op = operations[index]!;
		const path = `operations.${index}`;
		if (op.op === 'replace_document') {
			next = normalizePmNodeIds(op.document);
			continue;
		}
		if (op.op === 'delete_node') {
			const removed = removeNode(next, op.nodeId);
			next = removed.document;
			if (!removed.removed) diagnostics.push(diagnostic(path, `Node "${op.nodeId}" not found.`));
			continue;
		}
		if (op.op === 'replace_node') {
			const normalized = normalizePmNodeIds({ type: 'doc', content: [op.node] }).content?.[0];
			if (!normalized) {
				diagnostics.push(diagnostic(path, 'Replacement node is invalid.'));
				continue;
			}
			next = replaceNode(next, op.nodeId, normalized);
			continue;
		}
		if (op.op === 'patch_attrs') {
			let patched = false;
			const walk = (node: PMDocJSON | PMNodeJSON): PMDocJSON | PMNodeJSON => {
				if (node.attrs?.nodeId === op.nodeId) {
					patched = true;
					return { ...node, attrs: { ...(node.attrs ?? {}), ...op.attrs, nodeId: op.nodeId } };
				}
				return { ...node, content: (node.content ?? []).map((child) => walk(child) as PMNodeJSON) };
			};
			next = walk(next) as PMDocJSON;
			if (!patched) diagnostics.push(diagnostic(path, `Node "${op.nodeId}" not found.`));
			continue;
		}
		if (op.op === 'insert_node') {
			const parent = findChildContainer(next, op.parentNodeId, diagnostics);
			if (!parent) continue;
			const normalized = normalizePmNodeIds({ type: 'doc', content: [op.node] }).content?.[0];
			if (!normalized) {
				diagnostics.push(diagnostic(path, 'Inserted node is invalid.'));
				continue;
			}
			const content = [...(parent.content ?? [])];
			content.splice(
				Math.max(0, Math.min(op.index ?? content.length, content.length)),
				0,
				normalized
			);
			parent.content = content;
			continue;
		}
		if (op.op === 'move_node') {
			const removed = removeNode(next, op.nodeId);
			if (!removed.removed) {
				diagnostics.push(diagnostic(path, `Node "${op.nodeId}" not found.`));
				continue;
			}
			next = removed.document;
			const parent = findChildContainer(next, op.parentNodeId, diagnostics);
			if (!parent) continue;
			const content = [...(parent.content ?? [])];
			content.splice(Math.max(0, Math.min(op.index, content.length)), 0, removed.removed);
			parent.content = content;
		}
	}

	next = normalizePmNodeIds(next);
	diagnostics.push(...validateNotebookPmDocument(next));
	return { document: diagnostics.length ? null : next, diagnostics };
}
