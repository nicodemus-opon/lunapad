import { Cron } from 'croner';
import fs from 'node:fs';
import path from 'node:path';
import type { DbtSchedule } from '$lib/types/schedule';

// The currently open dbt project folder — set when a project is opened.
let currentFolder: string | null = null;

export function getCurrentFolder(): string | null {
	return currentFolder;
}

export function setCurrentFolder(folder: string | null): void {
	currentFolder = folder;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function schedulesFilePath(folder: string): string {
	return path.join(folder, 'schedules.json');
}

export function loadSchedules(folder: string): DbtSchedule[] {
	try {
		const raw = fs.readFileSync(schedulesFilePath(folder), 'utf-8');
		return JSON.parse(raw) as DbtSchedule[];
	} catch {
		return [];
	}
}

export function saveSchedules(folder: string, schedules: DbtSchedule[]): void {
	fs.writeFileSync(schedulesFilePath(folder), JSON.stringify(schedules, null, 2));
}

// ── Cron utilities (croner used only as parser, not as a job scheduler) ───────

/** Returns true if the given cron expression should have fired during the current minute. */
export function isDueNow(cron: string): boolean {
	const now = new Date();
	// Floor to the start of the current minute
	const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
	try {
		const job = new Cron(cron, { paused: true });
		// Get the next occurrence starting just before this minute
		const next = job.nextRun(new Date(minuteStart.getTime() - 1));
		job.stop();
		if (!next) return false;
		return next >= minuteStart && next < new Date(minuteStart.getTime() + 60_000);
	} catch {
		return false;
	}
}

export function getNextRuns(cron: string, count = 3): Date[] {
	try {
		const job = new Cron(cron, { paused: true });
		const runs: Date[] = [];
		let prev: Date | null = null;
		for (let i = 0; i < count; i++) {
			const next = job.nextRun(prev ?? undefined);
			if (!next) break;
			runs.push(next);
			prev = next;
		}
		job.stop();
		return runs;
	} catch {
		return [];
	}
}

export function isValidCron(cron: string): boolean {
	try {
		const job = new Cron(cron, { paused: true });
		job.stop();
		return true;
	} catch {
		return false;
	}
}

// ── Schedule CRUD ─────────────────────────────────────────────────────────────

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function upsertSchedule(folder: string, incoming: DbtSchedule): DbtSchedule {
	const schedules = loadSchedules(folder);
	const idx = schedules.findIndex((s) => s.id === incoming.id);
	let schedule: DbtSchedule;
	if (idx !== -1) {
		schedule = { ...schedules[idx], ...incoming };
		schedules[idx] = schedule;
	} else {
		schedule = { ...incoming, id: incoming.id || makeId() };
		schedules.push(schedule);
	}
	saveSchedules(folder, schedules);
	return schedule;
}

export function deleteSchedule(folder: string, id: string): void {
	const schedules = loadSchedules(folder).filter((s) => s.id !== id);
	saveSchedules(folder, schedules);
}
