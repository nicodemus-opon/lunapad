export interface ProjectChangeDetail {
	projectId: string;
	projectName: string;
	projectFolder?: string | null;
}

const PROJECT_CHANGE_EVENT = 'lunapad:project-change';

export function emitProjectChange(detail: ProjectChangeDetail): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent<ProjectChangeDetail>(PROJECT_CHANGE_EVENT, { detail }));
}

export function onProjectChange(handler: (detail: ProjectChangeDetail) => void | Promise<void>): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const listener = (event: Event) => {
		void handler((event as CustomEvent<ProjectChangeDetail>).detail);
	};
	window.addEventListener(PROJECT_CHANGE_EVENT, listener);
	return () => window.removeEventListener(PROJECT_CHANGE_EVENT, listener);
}
