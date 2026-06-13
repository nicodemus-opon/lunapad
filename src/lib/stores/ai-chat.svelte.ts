import type { Cell } from './notebook.svelte.js';

export interface ContextPill {
	cellId: string;
	cellName: string;
}

export interface ActionEvent {
	tool: string;
	label: string;
	cellId?: string;
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'error';
	text: string;
	isStreaming: boolean;
	contextPills: ContextPill[];
	actionEvents: ActionEvent[];
	createdAt: number;
}

export interface NotebookSnapshot {
	notebookId: string;
	/** Structural fields only — no result/status data. */
	cells: Pick<Cell, 'id' | 'outputName' | 'code' | 'markdown' | 'language' | 'cellType' | 'display' | 'guiStages' | 'editMode' | 'connectionId'>[];
}

const PANEL_WIDTH_KEY = 'lunapad.aichat.width';
const DEFAULT_WIDTH = 340;

function loadWidth(): number {
	if (typeof localStorage === 'undefined') return DEFAULT_WIDTH;
	const raw = localStorage.getItem(PANEL_WIDTH_KEY);
	const n = raw ? parseInt(raw, 10) : NaN;
	return isNaN(n) ? DEFAULT_WIDTH : Math.max(260, Math.min(520, n));
}

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

// ── State ─────────────────────────────────────────────────────────────────────

let _isOpen = $state(false);
let _panelWidth = $state(DEFAULT_WIDTH);
let _messages = $state<ChatMessage[]>([]);
let _isGenerating = $state(false);
let _contextCellIds = $state<string[]>([]);
let _pendingSnapshot = $state<NotebookSnapshot | null>(null);
let _undoAvailable = $state(false);
let _ghostCellIds = $state<Set<string>>(new Set());

let _activeController: AbortController | null = null;

// ── Panel ─────────────────────────────────────────────────────────────────────

export function initAIChatWidth(): void {
	_panelWidth = loadWidth();
}

export function getAIChatOpen(): boolean { return _isOpen; }
export function setAIChatOpen(v: boolean): void { _isOpen = v; }
export function toggleAIChat(): void { _isOpen = !_isOpen; }

export function getAIChatPanelWidth(): number { return _panelWidth; }
export function setAIChatPanelWidth(w: number): void {
	_panelWidth = Math.max(260, Math.min(520, w));
	localStorage.setItem(PANEL_WIDTH_KEY, String(_panelWidth));
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function getMessages(): ChatMessage[] { return _messages; }

export function appendMessage(msg: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }): ChatMessage {
	const full: ChatMessage = { id: makeId(), createdAt: Date.now(), ...msg };
	_messages = [..._messages, full];
	return full;
}

export function updateMessageText(id: string, delta: string): void {
	_messages = _messages.map((m) => m.id === id ? { ...m, text: m.text + delta } : m);
}

export function setMessageStreaming(id: string, streaming: boolean): void {
	_messages = _messages.map((m) => m.id === id ? { ...m, isStreaming: streaming } : m);
}

export function appendActionEvent(msgId: string, event: ActionEvent): void {
	_messages = _messages.map((m) =>
		m.id === msgId ? { ...m, actionEvents: [...m.actionEvents, event] } : m
	);
}

export function clearMessages(): void { _messages = []; }

// ── Generation state ──────────────────────────────────────────────────────────

export function getIsGenerating(): boolean { return _isGenerating; }
export function setIsGenerating(v: boolean): void { _isGenerating = v; }

export function getActiveController(): AbortController | null { return _activeController; }
export function setActiveController(c: AbortController | null): void { _activeController = c; }

export function abortGeneration(): void {
	_activeController?.abort();
	_activeController = null;
	_isGenerating = false;
	// Clear all ghost markers on abort
	_ghostCellIds = new Set();
	// Mark last streaming message as done
	_messages = _messages.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m);
}

// ── Context cells ─────────────────────────────────────────────────────────────

export function getContextCellIds(): string[] { return _contextCellIds; }

export function addContextCell(id: string): void {
	if (!_contextCellIds.includes(id)) {
		_contextCellIds = [..._contextCellIds, id];
	}
}

export function removeContextCell(id: string): void {
	_contextCellIds = _contextCellIds.filter((cid) => cid !== id);
}

export function clearContextCells(): void { _contextCellIds = []; }

// ── Ghost cells ───────────────────────────────────────────────────────────────

export function getGhostCellIds(): Set<string> { return _ghostCellIds; }

export function markGhostCell(id: string): void {
	const next = new Set(_ghostCellIds);
	next.add(id);
	_ghostCellIds = next;
}

export function unmarkGhostCell(id: string): void {
	const next = new Set(_ghostCellIds);
	next.delete(id);
	_ghostCellIds = next;
}

export function clearGhostCells(): void { _ghostCellIds = new Set(); }

// ── Snapshot / undo ───────────────────────────────────────────────────────────

export function getPendingSnapshot(): NotebookSnapshot | null { return _pendingSnapshot; }
export function setPendingSnapshot(snap: NotebookSnapshot | null): void { _pendingSnapshot = snap; }

export function getUndoAvailable(): boolean { return _undoAvailable; }
export function setUndoAvailable(v: boolean): void { _undoAvailable = v; }
