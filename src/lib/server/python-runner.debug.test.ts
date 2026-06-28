import { describe, it, expect } from 'vitest';
import { spawnPythonCell, getPythonJob } from './python-runner';

describe('python-runner error debug', () => {
	it('captures a raised exception', async () => {
		const jobId = spawnPythonCell('debug-nb', 'raise ValueError("boom test")', {});
		const job = getPythonJob(jobId)!;
		await new Promise<void>((resolve) => {
			job.emitter.once('done', () => resolve());
		});
		console.log('RESULT', JSON.stringify(job.result));
		expect(job.result?.error).toBeTruthy();
	}, 30000);
});
