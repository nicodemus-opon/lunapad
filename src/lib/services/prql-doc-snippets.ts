export interface PrqlDocSnippet {
	id: string;
	title: string;
	prql: string;
	tags: string[];
}

// Canonical snippets derived from PRQL stdlib docs pages linked in this task.
export const PRQL_DOC_SNIPPETS: PrqlDocSnippet[] = [
	{
		id: 'transform-aggregate-basic',
		title: 'Aggregate basic',
		prql: `from employees
aggregate {
  average salary,
  ct = count salary
}`,
		tags: ['transform', 'aggregate']
	},
	{
		id: 'transform-append-basic',
		title: 'Append basic',
		prql: `from employees_1
append employees_2`,
		tags: ['transform', 'append']
	},
	{
		id: 'transform-append-remove',
		title: 'Remove rows',
		prql: `from employees_1
remove employees_2`,
		tags: ['transform', 'append', 'remove']
	},
	{
		id: 'transform-append-intersect',
		title: 'Intersect rows',
		prql: `from employees_1
intersect employees_2`,
		tags: ['transform', 'append', 'intersect']
	},
	{
		id: 'transform-derive-basic',
		title: 'Derive basic',
		prql: `from employees
derive gross_salary = salary + payroll_tax`,
		tags: ['transform', 'derive']
	},
	{
		id: 'transform-filter-basic',
		title: 'Filter basic',
		prql: `from employees
filter age > 25`,
		tags: ['transform', 'filter']
	},
	{
		id: 'transform-filter-in-list',
		title: 'Filter in list',
		prql: `from employees
filter (department | in ["IT", "HR"])`,
		tags: ['transform', 'filter', 'in']
	},
	{
		id: 'transform-group-aggregate',
		title: 'Group aggregate',
		prql: `from employees
group {title, country} (
  aggregate {
    average salary,
    ct = count salary
  }
)`,
		tags: ['transform', 'group', 'aggregate']
	},
	{
		id: 'transform-group-take-first',
		title: 'Group with sort + take',
		prql: `from employees
group role (
  sort join_date
  take 1
)`,
		tags: ['transform', 'group', 'take', 'distinct-like']
	},
	{
		id: 'transform-join-left',
		title: 'Join left',
		prql: `from employees
join side:left positions (employees.id==positions.employee_id)`,
		tags: ['transform', 'join']
	},
	{
		id: 'transform-join-shorthand',
		title: 'Join self-equality shorthand',
		prql: `from employees
join positions (==emp_no)`,
		tags: ['transform', 'join', 'shorthand']
	},
	{
		id: 'transform-loop-basic',
		title: 'Loop basic',
		prql: `from [{n = 1}]
loop (
  filter n<4
  select n = n+1
)`,
		tags: ['transform', 'loop']
	},
	{
		id: 'transform-select-basic',
		title: 'Select basic',
		prql: `from employees
select first_name`,
		tags: ['transform', 'select']
	},
	{
		id: 'transform-select-exclude',
		title: 'Select exclude columns',
		prql: `from tracks
select !{milliseconds, bytes}`,
		tags: ['transform', 'select', 'exclude']
	},
	{
		id: 'transform-sort-multi',
		title: 'Sort multiple keys',
		prql: `from employees
sort {age, -tenure, +salary}`,
		tags: ['transform', 'sort']
	},
	{
		id: 'transform-take-range',
		title: 'Take range',
		prql: `from orders
sort {-value, created_at}
take 101..110`,
		tags: ['transform', 'take', 'range']
	},
	{
		id: 'transform-window-rolling',
		title: 'Window rolling',
		prql: `from employees
group employee_id (
  sort month
  window rolling:12 (
    derive {trail_12_m_comp = sum paycheck}
  )
)`,
		tags: ['transform', 'window', 'rolling']
	},
	{
		id: 'transform-window-rows-range',
		title: 'Window rows and range',
		prql: `from [
  {time_id=1, value=15},
  {time_id=2, value=11},
  {time_id=3, value=16},
  {time_id=4, value=9},
  {time_id=7, value=20},
  {time_id=8, value=22},
]
window rows:-2..0 (
  sort time_id
  derive {sma3rows = average value}
)
window range:-2..0 (
  sort time_id
  derive {sma3range = average value}
)`,
		tags: ['transform', 'window', 'rows', 'range']
	},
	{
		id: 'function-text',
		title: 'Text functions',
		prql: `from employees
select {
  (last_name | text.lower | text.starts_with("a")),
  (title | text.replace "manager" "chief"),
}`,
		tags: ['function', 'text']
	},
	{
		id: 'function-math',
		title: 'Math functions',
		prql: `from employees
select age_squared = (age | math.pow 2)`,
		tags: ['function', 'math']
	},
	{
		id: 'function-date-to-text',
		title: 'Date to_text',
		prql: `prql target:sql.duckdb

from invoices
select (invoice_date | date.to_text "%d/%m/%Y")`,
		tags: ['function', 'date']
	},
	{
		id: 'function-date-now',
		title: 'Date now',
		prql: `from test_tables
filter test_time < date.now`,
		tags: ['function', 'date']
	},
	{
		id: 'distinct-remove-duplicates',
		title: 'Remove duplicates',
		prql: `from employees
group employees.* (
  take 1
)`,
		tags: ['distinct', 'remove-duplicates']
	}
];
