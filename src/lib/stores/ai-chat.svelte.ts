import type { CellSnapshot } from './notebook.svelte.js';
import type { WorkspaceNamingRule, SprintTask, PipelinePhase } from '$lib/types/ai-chat.js';
import type { PlanAssertion } from '$lib/types/ai-subagents.js';

export interface WorkspaceStandards {
	namingRules: WorkspaceNamingRule[];
	customInstructions: string;
}

export interface ContextPill {
	cellId: string;
	cellName: string;
}

export interface ActionEvent {
	/** Stable id for keyed rendering — assigned by appendActionEvent. */
	id?: string;
	tool: string;
	label: string;
	cellId?: string;
	preview?: string;
	/** Before/after code for update_cell diff preview */
	oldCode?: string;
	newCode?: string;
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'error';
	text: string;
	isStreaming: boolean;
	hasError?: boolean;
	/** Set when generation was aborted by the user mid-stream. */
	stopped?: boolean;
	contextPills: ContextPill[];
	actionEvents: ActionEvent[];
	createdAt: number;
	suggestions?: string[];
}

export interface NotebookSnapshot {
	notebookId: string;
	cells: CellSnapshot[];
}

const PANEL_WIDTH_KEY = 'lunapad.aichat.width';
const WORKSPACE_STANDARDS_KEY = 'lunapad.aichat.standards';
const DEFAULT_WIDTH = 380;

function loadWidth(): number {
	if (typeof localStorage === 'undefined') return DEFAULT_WIDTH;
	const raw = localStorage.getItem(PANEL_WIDTH_KEY);
	const n = raw ? parseInt(raw, 10) : NaN;
	return isNaN(n) ? DEFAULT_WIDTH : Math.max(260, Math.min(520, n));
}

function loadWorkspaceStandards(): WorkspaceStandards {
	if (typeof localStorage === 'undefined') return { namingRules: [], customInstructions: '' };
	try {
		const raw = localStorage.getItem(WORKSPACE_STANDARDS_KEY);
		if (!raw) return { namingRules: [], customInstructions: '' };
		return JSON.parse(raw) as WorkspaceStandards;
	} catch {
		return { namingRules: [], customInstructions: '' };
	}
}

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

// ── State ─────────────────────────────────────────────────────────────────────

let _isOpen = $state(false);
let _panelWidth = $state(DEFAULT_WIDTH);
let _messages = $state<ChatMessage[]>([]);
let _isGenerating = $state(false);
// Human-readable label for the tool currently being called — lets long-running views
// (e.g. the Sprint board) show what's happening instead of looking frozen.
let _currentActivityLabel = $state<string | null>(null);
let _contextCellIds = $state<string[]>([]);
let _pendingSnapshot = $state<NotebookSnapshot | null>(null);
let _workspaceStandards = $state<WorkspaceStandards>({ namingRules: [], customInstructions: '' });
let _undoAvailable = $state(false);
let _ghostCellIds = $state<Set<string>>(new Set());

let _pendingSuggestion = $state<string | null>(null);

let _activeController: AbortController | null = null;
// Per-iteration checkpoint stack (max 5) — for step-undo
let _checkpoints = $state<NotebookSnapshot[]>([]);
// Confirmation gate state — resolves when user clicks Proceed/Cancel
let _confirmationRequest = $state<{
	cellCount: number;
	resolve: (proceed: boolean) => void;
} | null>(null);
// Plan proposal gate — resolves when user approves or rejects the modeling plan (before sql-gen starts)
let _pendingPlanProposal = $state<{
	models: Array<{
		name: string;
		grain: string;
		source?: string;
		depends_on?: string[];
		type?: string;
	}>;
	note?: string;
	assertions?: PlanAssertion[];
} | null>(null);
let _planProposalResolve = $state<((proceed: boolean) => void) | null>(null);
// Ask-user gate — resolves when the user picks a quick-reply option or submits free text
let _pendingAskUser = $state<{
	question: string;
	options?: string[];
	resolve: (answer: string) => void;
} | null>(null);

// Rolling history-summary cache (Improvement: token-budgeted history) — `atMessageCount` is the
// total message count (`allMsgs.length` in ai-chat-client.ts buildRequest) at the time the
// summary was generated; buildRequest treats the cache as stale once the conversation has grown
// past that point and kicks off a background refresh, but still uses the (slightly stale) cached
// text for the current turn rather than going without — better than nothing.
let _historySummaryCache = $state<{ atMessageCount: number; summary: string } | null>(null);

// Pipeline phases — populated by runSubagentPipeline (creation intent), shown as a stepper
let _pipelinePhases = $state<PipelinePhase[]>([]);

// Sprint tasks — populated by sprint_planning subagent, updated as tasks execute
let _sprintTasks = $state<SprintTask[]>([]);
// Sprint plan approval gate — resolves null (start building) or string (refinement feedback)
let _sprintPlanApprovalResolve: ((feedback: string | null) => void) | null = null;
// Reactive flag — _sprintPlanApprovalResolve is not $state (functions shouldn't be proxied)
let _sprintPlanApprovalPending = $state(false);

// ── Panel ─────────────────────────────────────────────────────────────────────

export function initAIChatWidth(): void {
	_panelWidth = loadWidth();
}

export function getAIChatOpen(): boolean {
	return _isOpen;
}
export function setAIChatOpen(v: boolean): void {
	_isOpen = v;
}
export function toggleAIChat(): void {
	_isOpen = !_isOpen;
}

export function getAIChatPanelWidth(): number {
	return _panelWidth;
}
export function setAIChatPanelWidth(w: number): void {
	// Called per pointermove during a resize drag — no synchronous localStorage
	// write here; callers persist once on release via persistAIChatPanelWidth.
	_panelWidth = Math.max(260, Math.min(520, w));
}
export function persistAIChatPanelWidth(): void {
	localStorage.setItem(PANEL_WIDTH_KEY, String(_panelWidth));
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function getMessages(): ChatMessage[] {
	return _messages;
}

export function getHistorySummaryCache(): { atMessageCount: number; summary: string } | null {
	return _historySummaryCache;
}
export function setHistorySummaryCache(
	cache: { atMessageCount: number; summary: string } | null
): void {
	_historySummaryCache = cache;
}

export function appendMessage(
	msg: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }
): ChatMessage {
	const full: ChatMessage = { id: makeId(), createdAt: Date.now(), ...msg };
	_messages = [..._messages, full];
	return full;
}

export function updateMessageText(id: string, delta: string): void {
	_messages = _messages.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m));
}

export function setMessageStreaming(id: string, streaming: boolean): void {
	_messages = _messages.map((m) => (m.id === id ? { ...m, isStreaming: streaming } : m));
}

export function appendActionEvent(msgId: string, event: ActionEvent): void {
	const withId: ActionEvent = { ...event, id: event.id ?? makeId() };
	_messages = _messages.map((m) =>
		m.id === msgId ? { ...m, actionEvents: [...m.actionEvents, withId] } : m
	);
}

/** Append a distinct error message to the thread (rendered with destructive styling). */
export function appendErrorMessage(text: string): ChatMessage {
	return appendMessage({
		role: 'error',
		text,
		isStreaming: false,
		contextPills: [],
		actionEvents: []
	});
}

export function updateLastActionEvent(msgId: string, update: Partial<ActionEvent>): void {
	_messages = _messages.map((m) => {
		if (m.id !== msgId || m.actionEvents.length === 0) return m;
		const events = [...m.actionEvents];
		events[events.length - 1] = { ...events[events.length - 1], ...update };
		return { ...m, actionEvents: events };
	});
}

export function setMessageSuggestions(id: string, suggestions: string[]): void {
	_messages = _messages.map((m) => (m.id === id ? { ...m, suggestions } : m));
}

export function setMessageError(id: string): void {
	_messages = _messages.map((m) => (m.id === id ? { ...m, hasError: true } : m));
}

export function clearMessages(): void {
	_messages = [];
	_sprintTasks = [];
	_pipelinePhases = [];
	_currentActivityLabel = null;
	_historySummaryCache = null;
}

// ── Generation state ──────────────────────────────────────────────────────────

export function getIsGenerating(): boolean {
	return _isGenerating;
}
export function setIsGenerating(v: boolean): void {
	_isGenerating = v;
}

export function getCurrentActivityLabel(): string | null {
	return _currentActivityLabel;
}
export function setCurrentActivityLabel(label: string | null): void {
	_currentActivityLabel = label;
}

export function getActiveController(): AbortController | null {
	return _activeController;
}
export function setActiveController(c: AbortController | null): void {
	_activeController = c;
}

export function abortGeneration(): void {
	_activeController?.abort();
	_activeController = null;
	_isGenerating = false;
	_currentActivityLabel = null;
	// Clear all ghost markers on abort
	_ghostCellIds = new Set();
	_pipelinePhases = [];
	// Mark any streaming message as stopped so a halted partial answer is clearly
	// distinguishable from a completed one.
	_messages = _messages.map((m) =>
		m.isStreaming ? { ...m, isStreaming: false, stopped: true } : m
	);
	// Resolve any hanging confirmation or plan-proposal Promise so the old agentic loop exits
	if (_confirmationRequest) {
		_confirmationRequest.resolve(false);
		_confirmationRequest = null;
	}
	if (_planProposalResolve) {
		_planProposalResolve(false);
		_pendingPlanProposal = null;
		_planProposalResolve = null;
	}
	if (_sprintPlanApprovalResolve) {
		_sprintPlanApprovalResolve(null);
		_sprintPlanApprovalResolve = null;
		_sprintPlanApprovalPending = false;
	}
	if (_pendingAskUser) {
		_pendingAskUser.resolve('');
		_pendingAskUser = null;
	}
}

// ── Context cells ─────────────────────────────────────────────────────────────

export function getContextCellIds(): string[] {
	return _contextCellIds;
}

export function addContextCell(id: string): void {
	if (!_contextCellIds.includes(id)) {
		_contextCellIds = [..._contextCellIds, id];
	}
}

export function removeContextCell(id: string): void {
	_contextCellIds = _contextCellIds.filter((cid) => cid !== id);
}

export function clearContextCells(): void {
	_contextCellIds = [];
}

// ── Ghost cells ───────────────────────────────────────────────────────────────

export function getGhostCellIds(): Set<string> {
	return _ghostCellIds;
}

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

export function clearGhostCells(): void {
	_ghostCellIds = new Set();
}

// ── Snapshot / undo ───────────────────────────────────────────────────────────

export function getPendingSnapshot(): NotebookSnapshot | null {
	return _pendingSnapshot;
}
export function setPendingSnapshot(snap: NotebookSnapshot | null): void {
	_pendingSnapshot = snap;
}

export function getUndoAvailable(): boolean {
	return _undoAvailable;
}
export function setUndoAvailable(v: boolean): void {
	_undoAvailable = v;
}

// ── Per-iteration checkpoints (step-undo) ─────────────────────────────────────

export function getCheckpointCount(): number {
	return _checkpoints.length;
}

export function pushCheckpoint(snap: NotebookSnapshot): void {
	_checkpoints = [..._checkpoints.slice(-4), snap];
}

export function popCheckpoint(): NotebookSnapshot | null {
	if (_checkpoints.length === 0) return null;
	const last = _checkpoints[_checkpoints.length - 1];
	_checkpoints = _checkpoints.slice(0, -1);
	return last;
}

export function clearCheckpoints(): void {
	_checkpoints = [];
}

// ── Confirmation gate ─────────────────────────────────────────────────────────

export function getConfirmationRequest(): { cellCount: number } | null {
	return _confirmationRequest ? { cellCount: _confirmationRequest.cellCount } : null;
}

export function requestConfirmation(cellCount: number): Promise<boolean> {
	// If a confirmation is already pending, reject the new request rather than
	// overwriting the resolver (which would leave the first Promise hanging).
	if (_confirmationRequest) return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		_confirmationRequest = { cellCount, resolve };
	});
}

export function resolveConfirmation(proceed: boolean): void {
	_confirmationRequest?.resolve(proceed);
	_confirmationRequest = null;
}

// ── Plan proposal gate ────────────────────────────────────────────────────────

export function getPendingPlanProposal(): typeof _pendingPlanProposal {
	return _pendingPlanProposal;
}

export function setPendingPlanProposal(proposal: typeof _pendingPlanProposal): void {
	_pendingPlanProposal = proposal;
}

export function requestPlanApproval(
	proposal: NonNullable<typeof _pendingPlanProposal>
): Promise<boolean> {
	if (_planProposalResolve) return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		_pendingPlanProposal = proposal;
		_planProposalResolve = resolve;
	});
}

export function resolvePlanApproval(proceed: boolean): void {
	_planProposalResolve?.(proceed);
	_pendingPlanProposal = null;
	_planProposalResolve = null;
}

// ── Ask-user gate ─────────────────────────────────────────────────────────────

export function getPendingAskUser(): { question: string; options?: string[] } | null {
	return _pendingAskUser
		? { question: _pendingAskUser.question, options: _pendingAskUser.options }
		: null;
}

export function requestAskUser(question: string, options?: string[]): Promise<string> {
	// If a question is already pending, don't overwrite the resolver (would leave it hanging).
	if (_pendingAskUser) return Promise.resolve('');
	return new Promise<string>((resolve) => {
		_pendingAskUser = { question, options, resolve };
	});
}

export function resolveAskUser(answer: string): void {
	_pendingAskUser?.resolve(answer);
	_pendingAskUser = null;
}

// ── Input suggestion ─────────────────────────────────────────────────────────

export function getPendingSuggestion(): string | null {
	return _pendingSuggestion;
}
export function setPendingSuggestion(text: string): void {
	_pendingSuggestion = text;
}
export function clearPendingSuggestion(): void {
	_pendingSuggestion = null;
}

// ── Workspace standards ───────────────────────────────────────────────────────

export function initWorkspaceStandards(): void {
	_workspaceStandards = loadWorkspaceStandards();
}

export function getWorkspaceStandards(): WorkspaceStandards {
	return _workspaceStandards;
}

export function setWorkspaceStandards(s: WorkspaceStandards): void {
	_workspaceStandards = s;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(WORKSPACE_STANDARDS_KEY, JSON.stringify(s));
	}
}

// ── Pipeline phases ───────────────────────────────────────────────────────────

export function getPipelinePhases(): PipelinePhase[] {
	return _pipelinePhases;
}

export function setPipelinePhases(phases: PipelinePhase[]): void {
	_pipelinePhases = phases;
}

export function updatePipelinePhase(id: PipelinePhase['id'], patch: Partial<PipelinePhase>): void {
	_pipelinePhases = _pipelinePhases.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

export function clearPipelinePhases(): void {
	_pipelinePhases = [];
}

// ── Sprint tasks ──────────────────────────────────────────────────────────────

export function getSprintTasks(): SprintTask[] {
	return _sprintTasks;
}

export function setSprintTasks(tasks: SprintTask[]): void {
	_sprintTasks = tasks;
}

export function updateSprintTask(id: string, patch: Partial<SprintTask>): void {
	const idx = _sprintTasks.findIndex((t) => t.id === id);
	if (idx >= 0) _sprintTasks[idx] = { ..._sprintTasks[idx], ...patch };
}

export function clearSprintTasks(): void {
	_sprintTasks = [];
}

// ── Sprint plan approval gate ─────────────────────────────────────────────────

export function isSprintPlanPendingApproval(): boolean {
	return _sprintPlanApprovalPending;
}

export function requestSprintPlanApproval(): Promise<string | null> {
	if (_sprintPlanApprovalResolve) return Promise.resolve(null);
	return new Promise<string | null>((resolve) => {
		_sprintPlanApprovalResolve = resolve;
		_sprintPlanApprovalPending = true;
	});
}

export function resolveSprintPlanApproval(feedback: string | null): void {
	_sprintPlanApprovalResolve?.(feedback);
	_sprintPlanApprovalResolve = null;
	_sprintPlanApprovalPending = false;
}
