import { describe, it, expect } from 'vitest';
import { spawnPythonCell, getPythonJob } from './python-runner';

describe('python-runner', () => {
	it('captures a raised exception', async () => {
		const jobId = spawnPythonCell('debug-nb', 'raise ValueError("boom test")', {});
		const job = getPythonJob(jobId)!;
		await new Promise<void>((resolve) => {
			job.emitter.once('done', () => resolve());
		});
		console.log('RESULT', JSON.stringify(job.result));
		expect(job.result?.error).toBeTruthy();
	}, 30000);

	it('captures stdout and a DataFrame from the last expression', async () => {
		const jobId = spawnPythonCell(
			'debug-nb-df',
			[
				'import pandas as pd',
				'df = pd.DataFrame({"id": [1, 2], "n": ["a", "b"]})',
				'df'
			].join('\n'),
			{}
		);
		const job = getPythonJob(jobId)!;
		await new Promise<void>((resolve) => {
			job.emitter.once('done', () => resolve());
		});
		expect(job.result?.error).toBeFalsy();
		expect(job.result?.dataframe?.columns).toEqual(['id', 'n']);
		expect(job.result?.dataframe?.rows).toHaveLength(2);
	}, 30000);
});
