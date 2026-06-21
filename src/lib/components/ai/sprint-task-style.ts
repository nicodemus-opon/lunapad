import { Search, SquarePlay, ChartBar, LayoutGrid, FileText } from '@lucide/svelte';
import type { SprintTaskType } from '$lib/types/ai-chat.js';

export const SPRINT_TASK_STYLE: Record<SprintTaskType, { icon: typeof Search; colorVar: string; label: string }> = {
	investigate: { icon: Search, colorVar: '--chart-1', label: 'Investigate' },
	build: { icon: SquarePlay, colorVar: '--chart-4', label: 'Build' },
	visualize: { icon: ChartBar, colorVar: '--chart-2', label: 'Visualize' },
	dashboard: { icon: LayoutGrid, colorVar: '--chart-3', label: 'Dashboard' },
	document: { icon: FileText, colorVar: '--chart-5', label: 'Document' }
};
