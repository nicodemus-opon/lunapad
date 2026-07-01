export type CommentAnchorType =
	| 'cell'
	| 'line_range'
	| 'result_row'
	| 'result_cell'
	| 'chart_element'
	| 'gui_stage'
	| 'notebook'
	| 'share_report'
	| 'dbt_test';

export interface CommentAnchorKey {
	notebookId?: string;
	cellId?: string;
	shareToken?: string;
	startLine?: number;
	endLine?: number;
	contentHash?: string;
	rowFingerprint?: string;
	column?: string;
	stageIndex?: number;
	testName?: string;
	seriesId?: string;
	category?: string;
	value?: unknown;
}

export type ThreadStatus = 'open' | 'resolved' | 'archived';

export interface CommentThread {
	id: string;
	anchorType: CommentAnchorType;
	anchorKey: CommentAnchorKey;
	notebookId: string | null;
	cellId: string | null;
	shareToken: string | null;
	title: string | null;
	status: ThreadStatus;
	assigneeId: string | null;
	createdBy: string;
	createdAt: string;
	resolvedAt: string | null;
	resolvedBy: string | null;
	commentCount: number;
	unread?: boolean;
}

export interface Comment {
	id: string;
	threadId: string;
	parentId: string | null;
	authorId: string;
	authorName: string | null;
	authorImage: string | null;
	body: string;
	createdAt: string;
	editedAt: string | null;
	deletedAt: string | null;
	reactions: { emoji: string; userIds: string[] }[];
}

export interface TeamUser {
	id: string;
	name: string;
	email: string;
	image: string | null;
	mention: string;
}

export interface InboxItem {
	thread: CommentThread;
	latestComment: Comment | null;
	reason: 'assigned' | 'mention' | 'unresolved' | 'share_review';
}

export interface PresenceEntry {
	userId: string;
	userName: string;
	userImage: string | null;
	notebookId: string | null;
	cellId: string | null;
	lastSeenAt: string;
}
