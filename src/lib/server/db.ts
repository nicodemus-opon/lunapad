import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://lunapad:lunapad@localhost:5432/lunapad';

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
	if (!_pool) {
		_pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
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
