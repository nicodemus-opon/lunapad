import type {
	Comment,
	CommentAnchorKey,
	CommentAnchorType,
	CommentThread,
	InboxItem,
	PresenceEntry,
	TeamUser,
	ThreadStatus
} from '$lib/types/comments';

interface CommentsState {
	cellCounts: Record<string, number>;
	notebookCounts: Record<string, number>;
	inboxUnread: number;
	inboxItems: InboxItem[];
	teamUsers: TeamUser[];
	presence: PresenceEntry[];
	reviewMode: boolean;
	panelOpen: boolean;
	panelTab: 'thread' | 'inbox';
	panelWidth: number;
	panelCellId: string | null;
	panelNotebookId: string | null;
	panelAnchor: { type: CommentAnchorType; key: CommentAnchorKey } | null;
}

const REVIEW_PANEL_WIDTH_KEY = 'lunapad.review.panel.width';
const DEFAULT_PANEL_WIDTH = 360;

const state = $state<CommentsState>({
	cellCounts: {},
	notebookCounts: {},
	inboxUnread: 0,
	inboxItems: [],
	teamUsers: [],
	presence: [],
	reviewMode: false,
	panelOpen: false,
	panelTab: 'thread',
	panelWidth: DEFAULT_PANEL_WIDTH,
	panelCellId: null,
	panelNotebookId: null,
	panelAnchor: null
});

if (typeof localStorage !== 'undefined') {
	const saved = Number(localStorage.getItem(REVIEW_PANEL_WIDTH_KEY));
	if (!Number.isNaN(saved) && saved >= 280 && saved <= 520) {
		state.panelWidth = saved;
	}
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;

export function getReviewMode(): boolean {
	return state.reviewMode;
}

export function setReviewMode(enabled: boolean): void {
	state.reviewMode = enabled;
}

export function getCellCommentCount(cellId: string): number {
	return state.cellCounts[cellId] ?? 0;
}

export function getNotebookCommentCount(notebookId: string): number {
	return state.notebookCounts[notebookId] ?? 0;
}

export function getInboxUnread(): number {
	return state.inboxUnread;
}

export function getInboxItems(): InboxItem[] {
	return state.inboxItems;
}

export function getTeamUsers(): TeamUser[] {
	return state.teamUsers;
}

export function getPresence(): PresenceEntry[] {
	return state.presence;
}

export function getReviewPanelOpen(): boolean {
	return state.panelOpen;
}

export function getReviewPanelTab(): 'thread' | 'inbox' {
	return state.panelTab;
}

export function getReviewPanelWidth(): number {
	return state.panelWidth;
}

export function setReviewPanelWidth(width: number): void {
	// Called per pointermove during a resize drag — no synchronous localStorage
	// write here; callers persist once on release via persistReviewPanelWidth.
	state.panelWidth = Math.min(520, Math.max(280, width));
}

export function persistReviewPanelWidth(): void {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(REVIEW_PANEL_WIDTH_KEY, String(state.panelWidth));
	}
}

export function toggleReviewPanel(): void {
	state.panelOpen = !state.panelOpen;
	if (state.panelOpen) state.panelTab = 'inbox';
}

export function setReviewPanelTab(tab: 'thread' | 'inbox'): void {
	state.panelTab = tab;
	state.panelOpen = true;
}

export function openInbox(): void {
	state.panelOpen = true;
	state.panelTab = 'inbox';
}

export function isCommentPanelOpen(): boolean {
	return state.panelOpen;
}

export function getCommentPanelContext(): {
	cellId: string | null;
	notebookId: string | null;
	anchor: { type: CommentAnchorType; key: CommentAnchorKey } | null;
} {
	return {
		cellId: state.panelCellId,
		notebookId: state.panelNotebookId,
		anchor: state.panelAnchor
	};
}

export function openCommentPanel(opts: {
	notebookId: string;
	cellId?: string | null;
	anchorType?: CommentAnchorType;
	anchorKey?: CommentAnchorKey;
}): void {
	state.panelOpen = true;
	state.panelTab = 'thread';
	state.panelNotebookId = opts.notebookId;
	state.panelCellId = opts.cellId ?? null;
	state.panelAnchor =
		opts.anchorType && opts.anchorKey
			? { type: opts.anchorType, key: opts.anchorKey }
			: opts.cellId
				? {
						type: 'cell',
						key: { notebookId: opts.notebookId, cellId: opts.cellId }
					}
				: null;
}

export function closeCommentPanel(): void {
	state.panelOpen = false;
	state.panelCellId = null;
	state.panelNotebookId = null;
	state.panelAnchor = null;
}

export async function refreshCellCount(cellId: string): Promise<void> {
	try {
		const res = await fetch(`/api/comments/counts?cellId=${encodeURIComponent(cellId)}`);
		if (!res.ok) return;
		const body = await res.json();
		state.cellCounts = { ...state.cellCounts, [cellId]: body.count ?? 0 };
	} catch {
		/* ignore */
	}
}

export async function refreshNotebookCount(notebookId: string): Promise<void> {
	try {
		const res = await fetch(`/api/comments/counts?notebookId=${encodeURIComponent(notebookId)}`);
		if (!res.ok) return;
		const body = await res.json();
		state.notebookCounts = { ...state.notebookCounts, [notebookId]: body.count ?? 0 };
	} catch {
		/* ignore */
	}
}

export async function refreshInbox(): Promise<void> {
	try {
		const [inboxRes, countRes] = await Promise.all([
			fetch('/api/comments/inbox'),
			fetch('/api/comments/inbox?count=1')
		]);
		if (inboxRes.ok) {
			const body = await inboxRes.json();
			state.inboxItems = body.items ?? [];
		}
		if (countRes.ok) {
			const body = await countRes.json();
			state.inboxUnread = body.unread ?? 0;
		}
	} catch {
		/* ignore */
	}
}

export async function loadTeamUsers(): Promise<void> {
	try {
		const res = await fetch('/api/team/users');
		if (!res.ok) return;
		const body = await res.json();
		state.teamUsers = body.users ?? [];
	} catch {
		/* ignore */
	}
}

export async function fetchThreads(opts: {
	notebookId?: string;
	cellId?: string;
	shareToken?: string;
	status?: ThreadStatus;
}): Promise<CommentThread[]> {
	const params = new URLSearchParams();
	if (opts.notebookId) params.set('notebookId', opts.notebookId);
	if (opts.cellId) params.set('cellId', opts.cellId);
	if (opts.shareToken) params.set('shareToken', opts.shareToken);
	if (opts.status) params.set('status', opts.status);
	const res = await fetch(`/api/comments/threads?${params}`);
	if (!res.ok) throw new Error('Failed to load threads');
	const body = await res.json();
	return body.threads ?? [];
}

export async function fetchThreadDetail(
	threadId: string
): Promise<{ thread: CommentThread; comments: Comment[] }> {
	const res = await fetch(`/api/comments/threads/${threadId}`);
	if (!res.ok) throw new Error('Failed to load thread');
	return res.json();
}

export async function createThread(input: {
	anchorType: CommentAnchorType;
	anchorKey: CommentAnchorKey;
	body: string;
	title?: string;
	assigneeId?: string | null;
}): Promise<{ thread: CommentThread; comment: Comment }> {
	const res = await fetch('/api/comments/threads', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create thread');
	const result = await res.json();
	if (input.anchorKey.cellId) void refreshCellCount(input.anchorKey.cellId);
	if (input.anchorKey.notebookId) void refreshNotebookCount(input.anchorKey.notebookId);
	void refreshInbox();
	return result;
}

export async function replyToThread(
	threadId: string,
	body: string,
	parentId?: string | null
): Promise<Comment> {
	const res = await fetch(`/api/comments/threads/${threadId}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ body, parentId })
	});
	if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to reply');
	const result = await res.json();
	void refreshInbox();
	return result.comment;
}

export async function updateThreadStatus(
	threadId: string,
	status: ThreadStatus
): Promise<CommentThread> {
	const res = await fetch(`/api/comments/threads/${threadId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ status })
	});
	if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update thread');
	const result = await res.json();
	void refreshInbox();
	return result.thread;
}

export async function markThreadsRead(threadIds: string[]): Promise<void> {
	await fetch('/api/comments/inbox', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ threadIds })
	});
	void refreshInbox();
}

export async function sendPresence(
	notebookId: string | null,
	cellId: string | null
): Promise<void> {
	try {
		await fetch('/api/presence', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ notebookId, cellId })
		});
	} catch {
		/* ignore */
	}
}

export async function refreshPresence(notebookId?: string | null): Promise<void> {
	try {
		const url = notebookId
			? `/api/presence?notebookId=${encodeURIComponent(notebookId)}`
			: '/api/presence';
		const res = await fetch(url);
		if (!res.ok) return;
		const body = await res.json();
		state.presence = body.presence ?? [];
	} catch {
		/* ignore */
	}
}

export function startCommentsPolling(notebookId?: string | null): void {
	stopCommentsPolling();
	void refreshInbox();
	void loadTeamUsers();
	if (notebookId) void refreshNotebookCount(notebookId);
	pollTimer = setInterval(() => {
		void refreshInbox();
		if (notebookId) void refreshNotebookCount(notebookId);
	}, 30_000);
	presenceTimer = setInterval(() => {
		void refreshPresence(notebookId ?? null);
	}, 15_000);
}

export function stopCommentsPolling(): void {
	if (pollTimer) clearInterval(pollTimer);
	if (presenceTimer) clearInterval(presenceTimer);
	pollTimer = null;
	presenceTimer = null;
}

export async function refreshAllCellCounts(cellIds: string[]): Promise<void> {
	await Promise.all(cellIds.map((id) => refreshCellCount(id)));
}
