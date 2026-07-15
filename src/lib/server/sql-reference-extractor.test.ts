import { describe, expect, it } from 'vitest';
import { tablesReferencedInSql } from './sql-reference-extractor.js';

describe('tablesReferencedInSql', () => {
	it('keeps schema-qualified table references intact', () => {
		expect(tablesReferencedInSql('select * from links.de_opportunities')).toEqual([
			'links.de_opportunities'
		]);
	});

	it('ignores cte aliases and common table functions', () => {
		const refs = tablesReferencedInSql(`
			with expanded as (
				select *
				from links.de_opportunities
				cross join unnest(tags) as t(tag)
			)
			select *
			from expanded
			join public.accounts a on a.id = expanded.account_id
		`);
		expect(refs).toEqual(['links.de_opportunities', 'public.accounts']);
	});

	it('supports quoted identifiers', () => {
		expect(tablesReferencedInSql('select * from "analytics"."daily orders" join `raw`.`users` u on true')).toEqual([
			'analytics.daily orders',
			'raw.users'
		]);
	});
});
