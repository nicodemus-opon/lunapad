import { describe, expect, it } from 'vitest';

import {
	extractLetBindings,
	guiToPreql,
	loopMiniStagesToBody,
	mergeParsedWithHiddenStages,
	parseLoopBodyToMiniStages,
	prqlToGuiStages,
	reconcileStageSequenceToAvailableColumns,
	reconcileStagesAfterSourceChange
} from '$lib/services/gui-prql';
import type { GUIPipelineStage } from '$lib/types/gui-pipeline';

describe('prqlToGuiStages', () => {
	it('round-trips GUI-generated PRQL for all supported stages', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'orders' },
			{
				type: 'filter',
				logic: 'and',
				conditions: [
					{ column: 'amount', op: '>=', value: '10' },
					{ column: 'status', op: 'in', value: 'paid, shipped' }
				]
			},
			{
				type: 'derive',
				columns: [
					{
						name: 'amount_taxed',
						expr: {
							mode: 'binary',
							left: { kind: 'column', value: 'amount' },
							op: '*',
							right: { kind: 'literal', value: '1.16' }
						}
					}
				]
			},
			{ type: 'select', columns: ['id', 'amount_taxed'] },
			{ type: 'sort', keys: [{ column: 'id', dir: 'desc' }] },
			{ type: 'take', n: 100 },
			{
				type: 'join',
				joinType: 'left',
				table: 'customers',
				conditions: [{ left: 'customer_id', right: 'id' }]
			},
			{
				type: 'group',
				by: ['customer_id'],
				aggregations: [{ name: 'total', func: 'sum', column: 'amount' }]
			}
		];

		const prql = guiToPreql(stages);
		expect(prqlToGuiStages(prql)).toEqual(stages);
	});

	it('falls back to a raw stage for syntax the GUI cannot parse structurally', () => {
		const result = prqlToGuiStages('from orders\nselect *');
		expect(result).not.toBeNull();
		expect(result).toHaveLength(2);
		expect(result![0]).toEqual({ type: 'from', table: 'orders' });
		expect(result![1]).toEqual({ type: 'raw', prql: 'select *' });
	});

	it('parses top-level aggregate into a structural group stage with empty keys', () => {
		const parsed = prqlToGuiStages(`from employees
aggregate {
	average salary,
	ct = count salary
}`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'group',
			by: [],
			aggregations: [
				{ name: '', func: 'average', column: 'salary' },
				{ name: 'ct', func: 'count', column: 'salary' }
			]
		});

		const regenerated = guiToPreql(parsed!);
		expect(regenerated).toContain('aggregate {');
	});

	it('parses and round-trips expanded aggregate functions structurally', () => {
		const parsed = prqlToGuiStages(`from employees
aggregate {
	variability = stddev salary,
	all_active = all is_active,
	any_flagged = any is_flagged,
	roles = concat_array role
}`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'group',
			by: [],
			aggregations: [
				{ name: 'variability', func: 'stddev', column: 'salary' },
				{ name: 'all_active', func: 'all', column: 'is_active' },
				{ name: 'any_flagged', func: 'any', column: 'is_flagged' },
				{ name: 'roles', func: 'concat_array', column: 'role' }
			]
		});

		const regenerated = guiToPreql(parsed!);
		expect(regenerated).toContain('stddev salary');
		expect(regenerated).toContain('all is_active');
		expect(regenerated).toContain('any is_flagged');
		expect(regenerated).toContain('concat_array role');
	});

	it('parses window and loop docs examples as structural stages', () => {
		const parsed = prqlToGuiStages(`from [{n = 1}]
loop (
	filter n<4
	select n = n+1
)
window rows:-2..0 (
	sort n
	derive {rolling_avg = average n}
)`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(3);
		expect(parsed![1]).toEqual({ type: 'loop', body: 'filter n<4\nselect n = n+1' });
		expect(parsed![2]).toEqual({
			type: 'window',
			frame: 'rows:-2..0',
			sortKeys: [{ column: 'n', dir: 'asc' }],
			derives: [{ name: 'rolling_avg', expr: { mode: 'raw', expr: 'average n' } }]
		});
	});

	it('parses multiline append blocks structurally', () => {
		const parsed = prqlToGuiStages(`from employees
append [
	from contractors,
	from interns
]`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({ type: 'append', sources: ['contractors', 'interns'] });
	});

	it('parses bracket-form sort lists structurally', () => {
		const parsed = prqlToGuiStages(`from employees
sort [-salary, name]`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'sort',
			keys: [
				{ column: 'salary', dir: 'desc' },
				{ column: 'name', dir: 'asc' }
			]
		});
	});

	it('parses join conditions split by && without requiring surrounding spaces', () => {
		const parsed = prqlToGuiStages(`from orders
join customers (customer_id==customers.id&&status==customers.status)`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'join',
			joinType: 'inner',
			table: 'customers',
			conditions: [
				{ left: 'customer_id', right: 'id' },
				{ left: 'status', right: 'status' }
			]
		});
	});

	it('parses wrapped filter conditions in conjunctions', () => {
		const parsed = prqlToGuiStages(`from employees
filter ((salary >= 1000) && (bonus > 0))`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'filter',
			logic: 'and',
			conditions: [
				{ column: 'salary', op: '>=', value: '1000' },
				{ column: 'bonus', op: '>', value: '0' }
			]
		});
	});

	it('parses filter with && at top level without outer parens', () => {
		const parsed = prqlToGuiStages(`from jobs
filter application_deadline >= current_date && application_deadline <= current_date + 30`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'filter',
			logic: 'and',
			conditions: [
				{ column: 'application_deadline', op: '>=', value: 'current_date' },
				{ column: 'application_deadline', op: '<=', value: 'current_date + 30' }
			]
		});
	});

	it('parses filter with SQL-style AND inside parens', () => {
		const parsed = prqlToGuiStages(`from jobs
filter (application_deadline >= current_date AND application_deadline <= current_date + 30)`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'filter',
			logic: 'and',
			conditions: [
				{ column: 'application_deadline', op: '>=', value: 'current_date' },
				{ column: 'application_deadline', op: '<=', value: 'current_date + 30' }
			]
		});
	});

	it('falls back to raw stage for unparseable compound filter (LLM mixed-style)', () => {
		const parsed = prqlToGuiStages(`from jobs
filter Col > 0 && (application_deadline >= current_date AND application_deadline <= current_date + 30)`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'raw',
			prql: 'filter Col > 0 && (application_deadline >= current_date AND application_deadline <= current_date + 30)'
		});
	});

	it('parses bracket-form derives inside group and window stages', () => {
		const parsed = prqlToGuiStages(`from employees
group dept (
	sort [name]
	derive [rank = row_number]
)
window rows:-1..0 (
	derive [delta = salary - lag_salary]
)`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(3);
		expect(parsed![1]).toEqual({
			type: 'group',
			by: ['dept'],
			aggregations: [],
			window: {
				sortKeys: [{ column: 'name', dir: 'asc' }],
				derives: [{ name: 'rank', expr: { mode: 'raw', expr: 'row_number' } }]
			}
		});
		expect(parsed![2]).toEqual({
			type: 'window',
			frame: 'rows:-1..0',
			sortKeys: [],
			derives: [
				{
					name: 'delta',
					expr: {
						mode: 'binary',
						left: { kind: 'column', value: 'salary' },
						op: '-',
						right: { kind: 'column', value: 'lag_salary' }
					}
				}
			]
		});
	});

	it('round-trips structured module functions with zero, one, two, and three arguments', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'events' },
			{
				type: 'derive',
				columns: [
					{ name: 'captured_at', expr: { mode: 'func', func: 'date.now', args: [] } },
					{
						name: 'month_start',
						expr: {
							mode: 'func',
							func: 'date.trunc',
							args: [
								{ kind: 'literal', value: 'month' },
								{ kind: 'column', value: 'event_time' }
							]
						}
					},
					{
						name: 'score_log',
						expr: {
							mode: 'func',
							func: 'math.log',
							args: [
								{ kind: 'literal', value: '10' },
								{ kind: 'column', value: 'score' }
							]
						}
					},
					{
						name: 'tag_slice',
						expr: {
							mode: 'func',
							func: 'text.extract',
							args: [
								{ kind: 'literal', value: '1' },
								{ kind: 'literal', value: '3' },
								{ kind: 'column', value: 'tag' }
							]
						}
					}
				]
			}
		];

		const prql = guiToPreql(stages);
		expect(prql).toContain('date.now');
		expect(prql).toContain('date.trunc "month" event_time');
		expect(prql).toContain('math.log 10 score');
		expect(prql).toContain('text.extract 1 3 tag');
		expect(prqlToGuiStages(prql)).toEqual(stages);
	});

	it('parses group take pattern used for distinct-like docs snippets', () => {
		const parsed = prqlToGuiStages(`from tracks
group {title, artist} (
	take 1
)`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'group',
			by: ['title', 'artist'],
			aggregations: [],
			take: 1
		});

		const regenerated = guiToPreql(parsed!);
		expect(regenerated).toContain('group {title, artist} (');
		expect(regenerated).toContain('take 1');
	});

	it('round-trips schema-qualified from sources', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'public.orders' },
			{ type: 'take', n: 10 }
		];
		const prql = guiToPreql(stages);
		expect(prql.startsWith('from public.orders')).toBe(true);
		expect(prqlToGuiStages(prql)).toEqual(stages);
	});

	it('parses alias with schema-qualified from source', () => {
		const parsed = prqlToGuiStages('from o=analytics.orders\nselect {o.id}');
		expect(parsed).not.toBeNull();
		expect(parsed![0]).toEqual({ type: 'from', table: 'analytics.orders', alias: 'o' });
	});

	it('quotes column names with spaces in group aggregations', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{
				type: 'group',
				by: ['Department'],
				aggregations: [
					{ name: 'n', func: 'count_distinct', column: 'Role Category' },
					{ name: 'total', func: 'sum', column: 'Base Salary' }
				]
			}
		];
		const prql = guiToPreql(stages);
		expect(prql).toContain('count_distinct `Role Category`');
		expect(prql).toContain('sum `Base Salary`');
		// Round-trips cleanly — stored column names remain space-containing strings
		const parsed = prqlToGuiStages(prql);
		expect(parsed).not.toBeNull();
		expect(parsed![1]).toEqual(stages[1]);
	});

	it('quotes column names with spaces in select and sort', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{ type: 'select', columns: ['Role Category', 'id'] },
			{ type: 'sort', keys: [{ column: 'Role Category', dir: 'desc' }] }
		];
		const prql = guiToPreql(stages);
		expect(prql).toContain('`Role Category`');
		const parsed = prqlToGuiStages(prql);
		expect(parsed).not.toBeNull();
		expect(parsed![1]).toEqual(stages[1]);
		expect(parsed![2]).toEqual(stages[2]);
	});

	it('quotes column names with spaces in filter conditions', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{
				type: 'filter',
				logic: 'and',
				conditions: [{ column: 'Role Category', op: '==', value: 'Engineer' }]
			}
		];
		const prql = guiToPreql(stages);
		expect(prql).toContain('`Role Category`');
		const parsed = prqlToGuiStages(prql);
		expect(parsed).not.toBeNull();
		expect(parsed![1]).toEqual(stages[1]);
	});

	it('parses group with backtick-quoted single group-by column (user bug report)', () => {
		const prql =
			'from employees\ngroup `Role Category` (\n  aggregate {\n    total = count `Scraped At`\n  }\n)';
		const parsed = prqlToGuiStages(prql);
		expect(parsed).not.toBeNull();
		expect(parsed![1]).toEqual({
			type: 'group',
			by: ['Role Category'],
			aggregations: [{ name: 'total', func: 'count', column: 'Scraped At' }]
		});
	});

	it('round-trips group with backtick-quoted group-by column', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{
				type: 'group',
				by: ['Role Category'],
				aggregations: [{ name: 'total', func: 'count', column: 'Scraped At' }]
			}
		];
		const prql = guiToPreql(stages);
		expect(prql).toContain('`Role Category`');
		expect(prql).toContain('`Scraped At`');
		const parsed = prqlToGuiStages(prql);
		expect(parsed).not.toBeNull();
		expect(parsed![1]).toEqual(stages[1]);
	});

	it('round-trips derive with backtick-quoted column name', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{
				type: 'derive',
				columns: [
					{ name: 'Full Name', expr: { mode: 'raw', expr: 'first_name' } },
					{
						name: 'gross cost',
						expr: {
							mode: 'binary',
							left: { kind: 'column', value: 'salary' },
							op: '+',
							right: { kind: 'column', value: 'benefits' }
						}
					}
				]
			}
		];
		const prql = guiToPreql(stages);
		expect(prql).toContain('`Full Name`');
		expect(prql).toContain('`gross cost`');
		const parsed = prqlToGuiStages(prql);
		expect(parsed).not.toBeNull();
		expect(parsed![1]).toEqual(stages[1]);
	});

	it('parses bracket-form derive blocks with case and s-string expressions', () => {
		const prql = `from mpesa_transactions
derive [
    amount = coalesce(\`Paid In\`, 0) + coalesce(\`Withdrawn\`, 0),

    direction = case [
        \`Paid In\` != null => "inflow",
        \`Withdrawn\` != null => "outflow",
        true => "unknown"
    ],

    tx_time = s"to_timestamp(\\"Completion Time\\" / 1000)",

    tx_date = s"date(to_timestamp(\\"Completion Time\\" / 1000))",

    month = s"date_trunc('month', to_timestamp(\\"Completion Time\\" / 1000))",

    year = s"date_trunc('year', to_timestamp(\\"Completion Time\\" / 1000))"
]`;

		const parsed = prqlToGuiStages(prql);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![0]).toEqual({ type: 'from', table: 'mpesa_transactions' });
		expect(parsed![1].type).toBe('derive');
		if (parsed![1].type !== 'derive') {
			throw new Error('expected derive stage');
		}

		expect(parsed![1].columns.map((column) => column.name)).toEqual([
			'amount',
			'direction',
			'tx_time',
			'tx_date',
			'month',
			'year'
		]);
		expect(parsed![1].columns[0].expr).toEqual({
			mode: 'raw',
			expr: 'coalesce(`Paid In`, 0) + coalesce(`Withdrawn`, 0)'
		});
		expect(parsed![1].columns[1].expr.mode).toBe('raw');
		expect((parsed![1].columns[1].expr as { mode: 'raw'; expr: string }).expr).toContain('case [');
		expect((parsed![1].columns[1].expr as { mode: 'raw'; expr: string }).expr).toContain(
			'`Paid In` != null => "inflow"'
		);
		expect(parsed![1].columns[2].expr).toEqual({
			mode: 'sstring',
			template: 'to_timestamp("Completion Time" / 1000)'
		});
		expect(parsed![1].columns[3].expr).toEqual({
			mode: 'sstring',
			template: 'date(to_timestamp("Completion Time" / 1000))'
		});
		expect(parsed![1].columns[4].expr).toEqual({
			mode: 'sstring',
			template: 'date_trunc(\'month\', to_timestamp("Completion Time" / 1000))'
		});
		expect(parsed![1].columns[5].expr).toEqual({
			mode: 'sstring',
			template: 'date_trunc(\'year\', to_timestamp("Completion Time" / 1000))'
		});
	});

	it('parses the mpesa example queries without falling back to raw stages', () => {
		const queries = [
			`from mpesa_transactions

derive [
	inflow = (\`Paid In\` ?? 0),
	outflow = abs(\`Withdrawn\` ?? 0),
	month = s"date_trunc('month', to_timestamp(\"Completion Time\" / 1000))"
]

group month (
	aggregate [
		total_in = sum inflow,
		total_out = sum outflow,
		net_flow = sum inflow - sum outflow,
		tx_count = count
	]
)

sort month`,
			`from mpesa_transactions

filter (\`Withdrawn\` != null)

derive [
	spend = abs(\`Withdrawn\`)
]

group Payee (
	aggregate [
		total_spent = sum spend,
		tx_count = count,
		avg_tx = average spend
	]
)

sort {-total_spent}

take 20`,
			`from mpesa_transactions

derive [
	category = case [
		(Details ~= "SAFARICOM DATA") => "data",
		(Details ~= "Merchant Payment") => "merchant",
		(Details ~= "Customer Transfer") => "transfer",
		(Details ~= "Pay Bill") => "paybill",
		true => "other"
	],

	spend = abs(\`Withdrawn\` ?? 0)
]

group category (
	aggregate [
		total_spent = sum spend,
		tx_count = count
	]
)

sort {-total_spent}`,
			`from mpesa_transactions

derive [
	spend = abs(\`Withdrawn\` ?? 0),
	tx_day = s"date(to_timestamp(\"Completion Time\" / 1000))"
]

group tx_day (
	aggregate [
		daily_spend = sum spend,
		tx_count = count
	]
)

sort tx_day`,
			`from mpesa_transactions

derive [
	amount = abs((\`Paid In\` ?? 0) + (\`Withdrawn\` ?? 0))
]

sort {-amount}

take 25

select [
	\`Receipt No.\`,
	Details,
	amount,
	Balance
]`,
			`from mpesa_transactions

filter (Payee != null)

derive [
	spend = abs(\`Withdrawn\` ?? 0)
]

group Payee (
	aggregate [
		visits = count,
		total_spent = sum spend,
		avg_spend = average spend
	]
)

filter (visits >= 5)

sort {-visits}`,
			`from mpesa_transactions

derive [
	month = s"date_trunc('month', to_timestamp(\"Completion Time\" / 1000))",

	net = (\`Paid In\` ?? 0) + (\`Withdrawn\` ?? 0)
]

group month (
	aggregate [
		net_change = sum net
	]
)

sort month`,
			`from mpesa_transactions

filter (Payee != null)

group Payee (
	aggregate [
		tx_count = count
	]
)

sort {-tx_count}

take 30`,
			`from mpesa_transactions

filter (\`Withdrawn\` != null)

derive [
	spend = abs(\`Withdrawn\`)
]

filter (spend > 10000)

sort {-spend}

select [
	\`Receipt No.\`,
	Payee,
	spend,
	Details
]`
		];

		for (const query of queries) {
			const parsed = prqlToGuiStages(query);
			expect(parsed).not.toBeNull();
			expect(parsed!.some((stage) => stage.type === 'raw')).toBe(false);
		}

		const letQuery = `let tx = (
	from mpesa_transactions

	derive [
		amount = (\`Paid In\` ?? 0) + (\`Withdrawn\` ?? 0),

		inflow = (\`Paid In\` ?? 0),

		outflow = abs(\`Withdrawn\` ?? 0),

		month = s"date_trunc('month', to_timestamp(\"Completion Time\" / 1000))",

		tx_day = s"date(to_timestamp(\"Completion Time\" / 1000))"
	]
)

from tx
group month (
	aggregate [
		income = sum inflow,
		spending = sum outflow,
		net = sum amount
	]
		)`;
		const { letBindings, mainPrql } = extractLetBindings(letQuery);
		expect(letBindings).toHaveLength(1);
		expect(prqlToGuiStages(letBindings[0].rawCode)?.some((stage) => stage.type === 'raw')).toBe(
			false
		);
		expect(prqlToGuiStages(mainPrql)?.some((stage) => stage.type === 'raw')).toBe(false);
	});

	it('preserves raw aggregate expressions inside group stages', () => {
		const parsed = prqlToGuiStages(`from mpesa_transactions
group month (
	aggregate [
		total_in = sum inflow,
		net_flow = sum inflow - sum outflow,
		tx_count = count
	]
)`);

		expect(parsed).not.toBeNull();
		expect(parsed![1].type).toBe('group');
		if (parsed![1].type !== 'group') {
			throw new Error('expected group stage');
		}
		expect(parsed![1].aggregations).toEqual([
			{ name: 'total_in', func: 'sum', column: 'inflow' },
			{ name: 'net_flow', func: 'raw', column: '', expr: 'sum inflow - sum outflow' },
			{ name: 'tx_count', func: 'count', column: '' }
		]);
		expect(guiToPreql(parsed!)).toContain('net_flow = sum inflow - sum outflow');
	});
});

const FULL_QUERY = `from invoices
filter invoice_date >= @1970-01-16
derive {
  transaction_fees = 0.8,
  income = total - transaction_fees
}
filter income > 1
group customer_id (
  aggregate {
    average total,
    sum_income = sum income,
    ct = count total,
  }
)
sort {-sum_income}
take 10
join c=customers (==customer_id)
derive name = f"{c.last_name}, {c.first_name}"
select {
  c.customer_id, name, sum_income
}
derive db_version = s"version()"`;

describe('full query round-trip', () => {
	it('parses full PRQL query into 11 stages', () => {
		const stages = prqlToGuiStages(FULL_QUERY);
		expect(stages).not.toBeNull();
		expect(stages!.length).toBe(11);
	});

	it('first stage is from invoices', () => {
		const stages = prqlToGuiStages(FULL_QUERY)!;
		expect(stages[0]).toEqual({ type: 'from', table: 'invoices' });
	});

	it('preserves @-prefixed date literal in filter', () => {
		const stages = prqlToGuiStages(FULL_QUERY)!;
		const filter = stages.find(
			(s) => s.type === 'filter' && s.conditions[0]?.value?.startsWith('@')
		);
		expect(filter).toBeDefined();
		const cond = (filter as any).conditions[0];
		expect(cond.column).toBe('invoice_date');
		expect(cond.op).toBe('>=');
		expect(cond.value).toBe('@1970-01-16');
	});

	it('parses fstring derive', () => {
		const stages = prqlToGuiStages(FULL_QUERY)!;
		const derive = stages.find(
			(s) => s.type === 'derive' && s.columns.some((c: any) => c.expr?.mode === 'fstring')
		) as any;
		expect(derive).toBeDefined();
		const col = derive.columns.find((c: any) => c.expr?.mode === 'fstring');
		expect(col.expr.template).toContain('c.last_name');
	});

	it('parses sstring derive', () => {
		const stages = prqlToGuiStages(FULL_QUERY)!;
		const derive = stages.find(
			(s) => s.type === 'derive' && s.columns.some((c: any) => c.expr?.mode === 'sstring')
		) as any;
		expect(derive).toBeDefined();
		const col = derive.columns.find((c: any) => c.expr?.mode === 'sstring');
		expect(col.expr.template).toBe('version()');
	});

	it('parses join with alias and shorthand condition', () => {
		const stages = prqlToGuiStages(FULL_QUERY)!;
		const join = stages.find((s) => s.type === 'join') as any;
		expect(join).toBeDefined();
		expect(join.alias).toBe('c');
		expect(join.table).toBe('customers');
		expect(join.conditions[0].shorthand).toBe(true);
		expect(join.conditions[0].right).toBe('customer_id');
	});

	it('parses group with average no-alias aggregation', () => {
		const stages = prqlToGuiStages(FULL_QUERY)!;
		const group = stages.find((s) => s.type === 'group') as any;
		expect(group).toBeDefined();
		expect(group.by).toContain('customer_id');
		const avgAgg = group.aggregations.find((a: any) => a.func === 'average');
		expect(avgAgg).toBeDefined();
		expect(avgAgg.name).toBe('');
	});

	it('regenerated PRQL contains key syntax', () => {
		const stages = prqlToGuiStages(FULL_QUERY)!;
		const output = guiToPreql(stages);
		expect(output).toContain('@1970-01-16');
		expect(output).toContain('f"');
		expect(output).toContain('s"');
		expect(output).toContain('join c=customers');
		expect(output).toContain('average');
	});

	it('parses bare same-column join shorthand in let-based sales query', () => {
		const query = `let sales = (
	from wg
	derive {
		revenue = \`Price (GHS)\` * \`Units Sold\`
	}
)

let item_stats = (
	from sales
	group \`Item Name\` (
		aggregate {
			item_revenue = sum revenue,
			item_units = sum \`Units Sold\`,
			item_orders = count
		}
	)
)

let category_stats = (
	from sales
	group Category (
		aggregate {
			category_revenue = sum revenue,
			category_units = sum \`Units Sold\`,
			category_orders = count
		}
	)
)

let location_stats = (
	from sales
	group Location (
		aggregate {
			location_revenue = sum revenue,
			location_units = sum \`Units Sold\`,
			location_orders = count
		}
	)
)

let customer_stats = (
	from sales
	group \`Customer Type\` (
		aggregate {
			customer_revenue = sum revenue,
			customer_units = sum \`Units Sold\`,
			customer_orders = count
		}
	)
)

from sales
join side:left item_stats (\`Item Name\`)
join side:left category_stats (Category)
join side:left location_stats (Location)
join side:left customer_stats (\`Customer Type\`)
select {
	\`Date Sold\`,
	\`Item Name\`,
	Category,
	Location,
	\`Customer Type\`,
	\`Price (GHS)\`,
	\`Units Sold\`,
	revenue,
	item_revenue,
	item_units,
	item_orders,
	category_revenue,
	category_units,
	category_orders,
	location_revenue,
	location_units,
	location_orders,
	customer_revenue,
	customer_units,
	customer_orders
}
sort {-revenue}`;

		const { letBindings, mainPrql } = extractLetBindings(query);
		expect(letBindings).toHaveLength(5);
		expect(
			letBindings.every(
				(binding) =>
					prqlToGuiStages(binding.rawCode)?.some((stage) => stage.type === 'raw') === false
			)
		).toBe(true);

		const parsed = prqlToGuiStages(mainPrql);
		expect(parsed).not.toBeNull();
		expect(parsed?.some((stage) => stage.type === 'raw')).toBe(false);

		const joins = parsed?.filter((stage) => stage.type === 'join') ?? [];
		expect(joins).toHaveLength(4);
		expect(joins.map((stage) => stage.table)).toEqual([
			'item_stats',
			'category_stats',
			'location_stats',
			'customer_stats'
		]);
		expect(joins.map((stage) => stage.conditions)).toEqual([
			[{ left: 'Item Name', right: 'Item Name', shorthand: true }],
			[{ left: 'Category', right: 'Category', shorthand: true }],
			[{ left: 'Location', right: 'Location', shorthand: true }],
			[{ left: 'Customer Type', right: 'Customer Type', shorthand: true }]
		]);

		const regenerated = guiToPreql(parsed ?? []);
		expect(regenerated).toContain(
			'join side:left item_stats (`Item Name` == item_stats.`Item Name`)'
		);
		expect(regenerated).toContain(
			'join side:left category_stats (Category == category_stats.Category)'
		);
		expect(regenerated).toContain(
			'join side:left location_stats (Location == location_stats.Location)'
		);
		expect(regenerated).toContain(
			'join side:left customer_stats (`Customer Type` == customer_stats.`Customer Type`)'
		);
	});
});

describe('reconcileStagesAfterSourceChange', () => {
	it('drops stale preset stages when a new source does not provide their columns', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'school_attendance' },
			{
				type: 'derive',
				columns: [
					{
						name: 'period_month',
						expr: {
							mode: 'sstring',
							template: 'date_trunc(\'month\', cast("application_deadline" as timestamp))'
						}
					}
				]
			},
			{
				type: 'group',
				by: ['period_month'],
				aggregations: [
					{ name: 'total_relevance_score', func: 'sum', column: 'relevance_score' },
					{ name: 'tx_count', func: 'count', column: '' }
				]
			},
			{ type: 'sort', keys: [{ column: 'period_month', dir: 'asc' }] },
			{ type: 'take', n: 100 }
		];

		const next = reconcileStagesAfterSourceChange(stages, {
			school_attendance: ['student_id', 'student_name', 'grade', 'attendance_date', 'reading_score']
		});

		expect(next).toEqual([
			{ type: 'from', table: 'school_attendance' },
			{ type: 'take', n: 100 }
		]);
	});

	it('preserves compatible downstream stages and trims invalid references', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'support_tickets' },
			{
				type: 'filter',
				logic: 'and',
				conditions: [
					{ column: 'priority', op: '==', value: 'High' },
					{ column: 'resolution_hours', op: '>', value: '4' }
				]
			},
			{ type: 'select', columns: ['priority', 'resolution_hours', 'customer_segment'] },
			{
				type: 'sort',
				keys: [
					{ column: 'resolution_hours', dir: 'desc' },
					{ column: 'priority', dir: 'asc' }
				]
			},
			{ type: 'take', n: 20 }
		];

		const next = reconcileStagesAfterSourceChange(stages, {
			support_tickets: ['priority', 'customer_segment', 'created_at']
		});

		expect(next).toEqual([
			{ type: 'from', table: 'support_tickets' },
			{
				type: 'filter',
				logic: 'and',
				conditions: [{ column: 'priority', op: '==', value: 'High' }]
			},
			{ type: 'select', columns: ['priority', 'customer_segment'] },
			{ type: 'sort', keys: [{ column: 'priority', dir: 'asc' }] },
			{ type: 'take', n: 20 }
		]);
	});
});

describe('reconcileStageSequenceToAvailableColumns', () => {
	it('repairs stale sort aliases against the current stage sequence output', () => {
		const next = reconcileStageSequenceToAvailableColumns(
			[
				{
					type: 'group',
					by: ['Payee'],
					aggregations: [{ name: 'row_count', func: 'count', column: '' }]
				},
				{
					type: 'group',
					by: ['Payee'],
					aggregations: [{ name: 'sum_row_count', func: 'sum', column: 'row_count' }]
				},
				{ type: 'sort', keys: [{ column: 'row_count', dir: 'desc' }] },
				{ type: 'take', n: 20 }
			],
			['Payee', 'Paid In', 'Completion Time']
		);

		expect(next).toHaveLength(4);
		expect(next[2]).toEqual({ type: 'sort', keys: [{ column: 'sum_row_count', dir: 'desc' }] });
	});
});

const EMPLOYEES_QUERY = `from employees
filter start_date > @2021-01-01            # Clear date syntax
derive {                                   # \`derive\` adds columns / variables
  gross_salary = salary + (tax ?? 0),      # Terse coalesce
  gross_cost = gross_salary + benefits,    # Variables can use other variables
}
filter gross_cost > 0
group {title, country} (                   # \`group\` runs a pipeline over each group
  aggregate {                              # \`aggregate\` reduces each group to a value
    average gross_salary,
    sum_gross_cost = sum gross_cost,       # \`=\` sets a column name
  }
)
filter sum_gross_cost > 100_000            # \`filter\` replaces both of SQL's \`WHERE\` & \`HAVING\`
derive id = f"{title}_{country}"           # F-strings like Python
derive country_code = s"LEFT(country, 2)"  # S-strings permit SQL as an escape hatch
sort {sum_gross_cost, -country}            # \`-country\` means descending order
take 1..20                                 # Range expressions (also valid as \`take 20\`)`;

describe('employees query round-trip', () => {
	it('parses into 10 stages', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY);
		expect(stages).not.toBeNull();
		expect(stages!.length).toBe(10);
	});

	it('first stage is from employees', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY)!;
		expect(stages[0]).toEqual({ type: 'from', table: 'employees' });
	});

	it('parses date filter with @ literal', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY)!;
		const filter = stages[1] as any;
		expect(filter.type).toBe('filter');
		expect(filter.conditions[0].column).toBe('start_date');
		expect(filter.conditions[0].value).toBe('@2021-01-01');
	});

	it('parses multi-column derive with coalesce raw expr', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY)!;
		const derive = stages[2] as any;
		expect(derive.type).toBe('derive');
		expect(derive.columns).toHaveLength(2);
		expect(derive.columns[0].name).toBe('gross_salary');
		expect(derive.columns[1].name).toBe('gross_cost');
	});

	it('parses group with average and aliased sum', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY)!;
		const group = stages[4] as any;
		expect(group.type).toBe('group');
		expect(group.by).toEqual(['title', 'country']);
		const avg = group.aggregations.find((a: any) => a.func === 'average');
		const sumRow = group.aggregations.find((a: any) => a.name === 'sum_gross_cost');
		expect(avg?.column).toBe('gross_salary');
		expect(sumRow?.func).toBe('sum');
		expect(sumRow?.column).toBe('gross_cost');
	});

	it('parses filter with underscore numeric literal', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY)!;
		const filter = stages[5] as any;
		expect(filter.type).toBe('filter');
		expect(filter.conditions[0].column).toBe('sum_gross_cost');
		expect(filter.conditions[0].value).toBe('100_000');
	});

	it('parses fstring and sstring derives', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY)!;
		const fderive = stages[6] as any;
		expect(fderive.columns[0].expr.mode).toBe('fstring');
		expect(fderive.columns[0].expr.template).toBe('{title}_{country}');
		const sderive = stages[7] as any;
		expect(sderive.columns[0].expr.mode).toBe('sstring');
		expect(sderive.columns[0].expr.template).toBe('LEFT(country, 2)');
	});

	it('parses take range 1..20', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY)!;
		const take = stages[9] as any;
		expect(take.type).toBe('take');
		expect(take.rangeFrom).toBe(1);
		expect(take.n).toBe(20);
	});

	it('round-trips back to equivalent PRQL', () => {
		const stages = prqlToGuiStages(EMPLOYEES_QUERY)!;
		const output = guiToPreql(stages);
		expect(output).toContain('@2021-01-01');
		expect(output).toContain('100_000');
		expect(output).toContain('f"');
		expect(output).toContain('s"');
		expect(output).toContain('take 1..20');
	});
});

// ── extractLetBindings ────────────────────────────────────────────────────────

const SOUNDTRACKS_QUERY = `let soundtracks = (
  from playlists
  filter name == 'TV Shows'
  join pt=playlist_track (==playlist_id)
  select pt.track_id
)
let high_energy = (
  from genres
  filter name == 'Rock And Roll' || name == 'Hip Hop/Rap'
)
from t=tracks
join side:left s=soundtracks (==track_id)
filter s.track_id == null
join g=high_energy (==genre_id)
select {t.track_id, track = t.name, genre = g.name}
take 10`;

describe('extractLetBindings', () => {
	it('splits soundtracks query into 2 let bindings + main PRQL', () => {
		const { letBindings, mainPrql } = extractLetBindings(SOUNDTRACKS_QUERY);
		expect(letBindings).toHaveLength(2);
		expect(mainPrql).toBeTruthy();
	});

	it('captures correct names for each let binding', () => {
		const { letBindings } = extractLetBindings(SOUNDTRACKS_QUERY);
		expect(letBindings[0].name).toBe('soundtracks');
		expect(letBindings[1].name).toBe('high_energy');
	});

	it('captures inner PRQL for soundtracks binding', () => {
		const { letBindings } = extractLetBindings(SOUNDTRACKS_QUERY);
		expect(letBindings[0].rawCode).toContain('from playlists');
		expect(letBindings[0].rawCode).toContain("filter name == 'TV Shows'");
		expect(letBindings[0].rawCode).toContain('select pt.track_id');
	});

	it('captures inner PRQL for high_energy binding', () => {
		const { letBindings } = extractLetBindings(SOUNDTRACKS_QUERY);
		expect(letBindings[1].rawCode).toContain('from genres');
		expect(letBindings[1].rawCode).toContain('Rock And Roll');
	});

	it('mainPrql contains the main pipeline without let blocks', () => {
		const { mainPrql } = extractLetBindings(SOUNDTRACKS_QUERY);
		expect(mainPrql).toContain('from t=tracks');
		expect(mainPrql).toContain('take 10');
		expect(mainPrql).not.toContain('let soundtracks');
		expect(mainPrql).not.toContain('let high_energy');
	});

	it('mainPrql is parseable as GUI stages', () => {
		const { mainPrql } = extractLetBindings(SOUNDTRACKS_QUERY);
		const stages = prqlToGuiStages(mainPrql);
		expect(stages).not.toBeNull();
		expect(stages!.length).toBe(6); // from, join, filter, join, select, take
	});

	it('inner pipeline for soundtracks is parseable as GUI stages', () => {
		const { letBindings } = extractLetBindings(SOUNDTRACKS_QUERY);
		const stages = prqlToGuiStages(letBindings[0].rawCode);
		expect(stages).not.toBeNull();
		expect(stages![0].type).toBe('from');
	});

	it('returns empty letBindings and full string for query without let', () => {
		const plain = 'from orders\nfilter amount > 10\ntake 5';
		const { letBindings, mainPrql } = extractLetBindings(plain);
		expect(letBindings).toHaveLength(0);
		expect(mainPrql).toBe(plain);
	});
});

// ── Iris window-function query ────────────────────────────────────────────────

const IRIS_QUERY = `from iris
derive {
  petal_area = petal_length * petal_width
}
group {species} (
  sort {petal_area}
  derive {
    avg_petal_area = average petal_area,
    std_petal_area = stddev petal_area,
    z_petal_area = (
      petal_area - average petal_area
    ) / stddev petal_area,
    petal_rank = rank petal_area,
    cumulative_petal_area = sum petal_area,
  }
)
derive {
  is_large = petal_area > avg_petal_area
}
select {species, petal_area, z_petal_area, petal_rank, is_large}
sort {species, -petal_rank}`;

describe('iris window group query', () => {
	it('parses into 6 stages', () => {
		const stages = prqlToGuiStages(IRIS_QUERY);
		expect(stages).not.toBeNull();
		expect(stages!.length).toBe(6);
	});

	it('stage types are correct', () => {
		const stages = prqlToGuiStages(IRIS_QUERY)!;
		expect(stages.map((s) => s.type)).toEqual([
			'from',
			'derive',
			'group',
			'derive',
			'select',
			'sort'
		]);
	});

	it('group stage has window property (not aggregate mode)', () => {
		const stages = prqlToGuiStages(IRIS_QUERY)!;
		const group = stages[2];
		expect(group.type).toBe('group');
		if (group.type !== 'group') return;
		expect(group.window).toBeDefined();
		expect(group.aggregations).toHaveLength(0);
	});

	it('group stage groups by species', () => {
		const stages = prqlToGuiStages(IRIS_QUERY)!;
		const group = stages[2];
		if (group.type !== 'group') return;
		expect(group.by).toEqual(['species']);
	});

	it('window has 1 sort key (petal_area asc)', () => {
		const stages = prqlToGuiStages(IRIS_QUERY)!;
		const group = stages[2];
		if (group.type !== 'group' || !group.window) return;
		expect(group.window.sortKeys).toHaveLength(1);
		expect(group.window.sortKeys[0]).toEqual({ column: 'petal_area', dir: 'asc' });
	});

	it('window has 5 derive columns', () => {
		const stages = prqlToGuiStages(IRIS_QUERY)!;
		const group = stages[2];
		if (group.type !== 'group' || !group.window) return;
		expect(group.window.derives).toHaveLength(5);
		expect(group.window.derives.map((d) => d.name)).toEqual([
			'avg_petal_area',
			'std_petal_area',
			'z_petal_area',
			'petal_rank',
			'cumulative_petal_area'
		]);
	});

	it('z_petal_area expression is stored as raw mode', () => {
		const stages = prqlToGuiStages(IRIS_QUERY)!;
		const group = stages[2];
		if (group.type !== 'group' || !group.window) return;
		const zCol = group.window.derives.find((d) => d.name === 'z_petal_area');
		expect(zCol).toBeDefined();
		expect(zCol!.expr.mode).toBe('raw');
	});

	it('round-trips: generated PRQL contains sort {petal_area} inside group block', () => {
		const stages = prqlToGuiStages(IRIS_QUERY)!;
		const prql = guiToPreql(stages);
		// The group block should embed a sort
		expect(prql).toContain('sort {petal_area}');
		// And the derive columns
		expect(prql).toContain('avg_petal_area');
		expect(prql).toContain('z_petal_area');
	});

	it('round-trip re-parses to the same window group structure', () => {
		const stages = prqlToGuiStages(IRIS_QUERY)!;
		const prql = guiToPreql(stages);
		const stages2 = prqlToGuiStages(prql);
		expect(stages2).not.toBeNull();
		const group1 = stages[2];
		const group2 = stages2![2];
		expect(group2.type).toBe('group');
		if (group1.type !== 'group' || group2.type !== 'group') return;
		expect(group2.by).toEqual(group1.by);
		expect(group2.window).toBeDefined();
		expect(group2.window!.sortKeys).toEqual(group1.window!.sortKeys);
		expect(group2.window!.derives.map((d) => d.name)).toEqual(
			group1.window!.derives.map((d) => d.name)
		);
	});
});

// ── mapErrorsToStages ─────────────────────────────────────────────────────────

import { mapErrorsToStages } from '$lib/services/gui-prql';
import type { PRQLError } from '$lib/services/prql';

function makeError(line: number | null, reason = 'error', hint: string | null = null): PRQLError {
	return {
		kind: 'Error',
		code: null,
		reason,
		hint,
		span: null,
		display: null,
		location: line !== null ? { start: [line, 0], end: [line, 1] } : null
	};
}

describe('mapErrorsToStages', () => {
	const threeStages: GUIPipelineStage[] = [
		{ type: 'from', table: 'employees' },
		{ type: 'filter', logic: 'and', conditions: [{ column: 'age', op: '>', value: '30' }] },
		{ type: 'select', columns: ['name', 'age'] }
	];

	it('attributes error at line 0 to from stage', () => {
		const map = mapErrorsToStages(threeStages, [makeError(0)], 0);
		expect(map.get(0)).toHaveLength(1);
		expect(map.get(1)).toBeUndefined();
		expect(map.get(2)).toBeUndefined();
	});

	it('attributes error at line 1 to filter stage (not from)', () => {
		const map = mapErrorsToStages(threeStages, [makeError(1)], 0);
		expect(map.get(0)).toBeUndefined();
		expect(map.get(1)).toHaveLength(1);
		expect(map.get(2)).toBeUndefined();
	});

	it('attributes error at line 2 to select stage (not filter)', () => {
		const map = mapErrorsToStages(threeStages, [makeError(2)], 0);
		expect(map.get(0)).toBeUndefined();
		expect(map.get(1)).toBeUndefined();
		expect(map.get(2)).toHaveLength(1);
	});

	it('adjusts for preceding lines correctly', () => {
		// Preceding: 2 lines, so GUI starts at line 2
		const map = mapErrorsToStages(threeStages, [makeError(3)], 2);
		// localRow = 3 - 2 = 1 → filter stage
		expect(map.get(1)).toHaveLength(1);
	});

	it('no-location errors fall back to stage 0 (not last stage)', () => {
		const map = mapErrorsToStages(threeStages, [makeError(null, 'table not found')], 0);
		expect(map.get(0)).toHaveLength(1);
		// Must NOT be on the last stage
		expect(map.get(2)).toBeUndefined();
	});

	it('preserves reason and hint in attributed error', () => {
		const map = mapErrorsToStages(
			threeStages,
			[makeError(1, 'col not found', 'did you mean x?')],
			0
		);
		const err = map.get(1)![0];
		expect(err.reason).toBe('col not found');
		expect(err.hint).toBe('did you mean x?');
	});

	it('handles multi-line stages with correct line offset', () => {
		// derive with 2 columns generates 4 lines:
		// line 0: from employees
		// line 1: derive {
		// line 2:   col_a = x
		// line 3:   col_b = y
		// line 4: }
		// line 5: select {name}
		const multiLineStages: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{
				type: 'derive',
				columns: [
					{ name: 'col_a', expr: { mode: 'raw', expr: 'x' } },
					{ name: 'col_b', expr: { mode: 'raw', expr: 'y' } }
				]
			},
			{ type: 'select', columns: ['name'] }
		];
		const prql = guiToPreql(multiLineStages);
		const prqlLines = prql.split('\n');
		// select is at the last line
		const selectLine = prqlLines.length - 1;
		const map = mapErrorsToStages(multiLineStages, [makeError(selectLine)], 0);
		// Error must be on select stage (index 2), not derive (index 1)
		expect(map.get(2)).toHaveLength(1);
		expect(map.get(1)).toBeUndefined();
	});

	it('maps errors to GUI indices when disabled stages are present', () => {
		const stagesWithHidden: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{
				type: 'filter',
				logic: 'and',
				conditions: [{ column: 'age', op: '>', value: '30' }],
				disabled: true
			},
			{ type: 'derive', columns: [{ name: 'age2', expr: { mode: 'raw', expr: 'age + 1' } }] }
		];

		// Compiled PRQL excludes disabled filter, so line 1 should map to derive (GUI index 2).
		const map = mapErrorsToStages(stagesWithHidden, [makeError(1)], 0);
		expect(map.get(2)).toHaveLength(1);
		expect(map.get(1)).toBeUndefined();
	});
});

describe('derive f/s triple-quoted strings', () => {
	it('parses triple-quoted fstring derive expression', () => {
		const stages = prqlToGuiStages('from employees\nderive label = f"""{name} ({title})"""');
		expect(stages).not.toBeNull();
		expect(stages![1]).toEqual({
			type: 'derive',
			columns: [{ name: 'label', expr: { mode: 'fstring', template: '{name} ({title})' } }]
		});
	});

	it('parses triple-quoted sstring derive expression', () => {
		const stages = prqlToGuiStages('from employees\nderive snippet = s"""LEFT(name, 2)"""');
		expect(stages).not.toBeNull();
		expect(stages![1]).toEqual({
			type: 'derive',
			columns: [{ name: 'snippet', expr: { mode: 'sstring', template: 'LEFT(name, 2)' } }]
		});
	});

	it('still parses legacy single-quoted f/s strings', () => {
		const stages = prqlToGuiStages('from employees\nderive a = f"{name}"\nderive b = s"version()"');
		expect(stages).not.toBeNull();
		expect(stages![1]).toEqual({
			type: 'derive',
			columns: [{ name: 'a', expr: { mode: 'fstring', template: '{name}' } }]
		});
		expect(stages![2]).toEqual({
			type: 'derive',
			columns: [{ name: 'b', expr: { mode: 'sstring', template: 'version()' } }]
		});
	});

	it('always emits triple-quoted form when generating PRQL', () => {
		const stages: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{
				type: 'derive',
				columns: [{ name: 'label', expr: { mode: 'fstring', template: '{name}' } }]
			},
			{
				type: 'derive',
				columns: [{ name: 'snippet', expr: { mode: 'sstring', template: 'version()' } }]
			}
		];

		const prql = guiToPreql(stages);
		expect(prql).toContain('f"""{name}"""');
		expect(prql).toContain('s"""version()"""');
	});
});

describe('mergeParsedWithHiddenStages', () => {
	it('preserves disabled stages in original positions', () => {
		const previous: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{
				type: 'filter',
				logic: 'and',
				conditions: [{ column: 'age', op: '>', value: '30' }],
				disabled: true
			},
			{ type: 'derive', columns: [{ name: 'age2', expr: { mode: 'raw', expr: 'age + 1' } }] }
		];

		const parsed: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{ type: 'derive', columns: [{ name: 'age3', expr: { mode: 'raw', expr: 'age + 2' } }] }
		];

		expect(mergeParsedWithHiddenStages(previous, parsed)).toEqual([
			{ type: 'from', table: 'employees' },
			{
				type: 'filter',
				logic: 'and',
				conditions: [{ column: 'age', op: '>', value: '30' }],
				disabled: true
			},
			{ type: 'derive', columns: [{ name: 'age3', expr: { mode: 'raw', expr: 'age + 2' } }] }
		]);
	});

	it('falls back to parsed stages when no hidden stages exist', () => {
		const previous: GUIPipelineStage[] = [{ type: 'from', table: 'employees' }];
		const parsed: GUIPipelineStage[] = [
			{ type: 'from', table: 'employees' },
			{ type: 'take', n: 5 }
		];
		expect(mergeParsedWithHiddenStages(previous, parsed)).toEqual(parsed);
	});
});

describe('loop structured helpers', () => {
	it('parses loop mini stages when loop body is structurally representable', () => {
		const parsed = parseLoopBodyToMiniStages('filter amount > 10\ntake 5');
		expect(parsed).not.toBeNull();
		expect(parsed).toEqual([
			{ type: 'filter', logic: 'and', conditions: [{ column: 'amount', op: '>', value: '10' }] },
			{ type: 'take', n: 5 }
		]);
	});

	it('serializes loop mini stages back to PRQL body text', () => {
		const body = loopMiniStagesToBody([
			{ type: 'filter', logic: 'and', conditions: [{ column: 'amount', op: '>', value: '10' }] },
			{ type: 'take', n: 5 }
		]);
		expect(body).toContain('filter amount > 10');
		expect(body).toContain('take 5');
	});

	it('parses loop stage with structured mode metadata when body is representable', () => {
		const parsed = prqlToGuiStages(`from orders
loop (
	filter amount > 10
	take 5
)`);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(2);
		expect(parsed![1]).toEqual({
			type: 'loop',
			body: 'filter amount > 10\ntake 5',
			mode: 'structured',
			structuredBody: [
				{ type: 'filter', logic: 'and', conditions: [{ column: 'amount', op: '>', value: '10' }] },
				{ type: 'take', n: 5 }
			]
		});
	});
});
