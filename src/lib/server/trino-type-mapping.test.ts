import { describe, expect, it } from 'vitest';
import {
	catalogTypeMappingProperties,
	catalogTypeMappingSession
} from './trino-type-mapping';

const JDBC_BASE = {
	'unsupported-type-handling': 'CONVERT_TO_VARCHAR'
};

describe('catalogTypeMappingProperties', () => {
	it('maps ClickHouse strings to varchar', () => {
		expect(catalogTypeMappingProperties('clickhouse')).toEqual({
			'clickhouse.map-string-as-varchar': 'true'
		});
	});

	it('maps PostgreSQL bytea and exposes unsupported types', () => {
		expect(catalogTypeMappingProperties('postgres')).toEqual({
			...JDBC_BASE,
			'jdbc-types-mapped-to-varchar': 'bytea'
		});
	});

	it('maps MySQL-family binary types and large decimals', () => {
		const expected = {
			...JDBC_BASE,
			'jdbc-types-mapped-to-varchar': 'binary,varbinary,tinyblob,blob,mediumblob,longblob',
			'decimal-mapping': 'allow_overflow',
			'decimal-default-scale': '0'
		};
		expect(catalogTypeMappingProperties('mysql')).toEqual(expected);
		expect(catalogTypeMappingProperties('mariadb')).toEqual(expected);
		expect(catalogTypeMappingProperties('singlestore')).toEqual(expected);
	});

	it('maps SQL Server binary types to varchar', () => {
		expect(catalogTypeMappingProperties('sqlserver')).toEqual({
			...JDBC_BASE,
			'jdbc-types-mapped-to-varchar': 'binary,varbinary,image'
		});
	});

	it('maps Redshift binary types to varchar', () => {
		expect(catalogTypeMappingProperties('redshift')).toEqual({
			...JDBC_BASE,
			'jdbc-types-mapped-to-varchar': 'varbinary,varbyte'
		});
	});

	it('maps Oracle raw/blob to varchar', () => {
		expect(catalogTypeMappingProperties('oracle')).toEqual({
			...JDBC_BASE,
			'jdbc-types-mapped-to-varchar': 'raw,blob'
		});
	});

	it('maps Snowflake binary types to varchar', () => {
		expect(catalogTypeMappingProperties('snowflake')).toEqual({
			...JDBC_BASE,
			'jdbc-types-mapped-to-varchar': 'binary,varbinary'
		});
	});

	it('returns nothing for non-JDBC connectors', () => {
		expect(catalogTypeMappingProperties('mongodb')).toEqual({});
		expect(catalogTypeMappingProperties('bigquery')).toEqual({});
		expect(catalogTypeMappingProperties('duckdb-wasm')).toEqual({});
	});
});

describe('catalogTypeMappingSession', () => {
	it('sets ClickHouse session override', () => {
		expect(catalogTypeMappingSession('analytics', 'clickhouse')).toBe(
			'analytics.map_string_as_varchar=true'
		);
	});

	it('sets JDBC unsupported_type_handling session override', () => {
		expect(catalogTypeMappingSession('primary_postgres', 'postgres')).toBe(
			'primary_postgres.unsupported_type_handling=CONVERT_TO_VARCHAR'
		);
		expect(catalogTypeMappingSession('prod_mysql', 'mysql')).toBe(
			'prod_mysql.unsupported_type_handling=CONVERT_TO_VARCHAR'
		);
	});

	it('returns undefined for connectors without session overrides', () => {
		expect(catalogTypeMappingSession('mongo_main', 'mongodb')).toBeUndefined();
	});
});
