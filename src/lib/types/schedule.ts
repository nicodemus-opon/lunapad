export interface DbtSchedule {
	id: string;
	label: string;
	select: string;
	cron: string;
	enabled: boolean;
	createdAt: number;
	lastRunAt: number | null;
	lastRunStatus: 'pass' | 'error' | null;
	lastRunJobId: string | null;
}
