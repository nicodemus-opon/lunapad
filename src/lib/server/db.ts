import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://lunapad:lunapad@localhost:5432/lunapad';

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
	if (!_pool) {
		_pool = new Pool({
			connectionString: DATABASE_URL,
			// Raised from 5: notebook open fires load + save + presence + inbox
			// + counts concurrently on top of a held-open SSE; 5 starved and the
			// proxy closed idle sockets (ERR_CONNECTION_CLOSED / 520).
			max: 10,
			connectionTimeoutMillis: 10_000,
			idleTimeoutMillis: 30_000
		});
		_pool.on('error', (err) => {
			console.error('[pg pool] idle client error:', err);
		});
	}
	return _pool;
}

export async function query<T = Record<string, unknown>>(
	sql: string,
	params: unknown[] = []
): Promise<T[]> {
	const result = await getPool().query(sql, params);
	return result.rows as T[];
}
