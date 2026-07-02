import type { ConnectionType } from '$lib/types/connection';

/** JDBC-based Trino connectors that share base-jdbc type-mapping properties. */
const JDBC_CONNECTION_TYPES = new Set<ConnectionType>([
	'postgres',
	'mysql',
	'mariadb',
	'singlestore',
	'sqlserver',
	'redshift',
	'oracle',
	'snowflake'
]);

function isJdbcConnectionType(type: ConnectionType): boolean {
	return JDBC_CONNECTION_TYPES.has(type);
}

function jdbcCatalogProperties(
	jdbcTypesMappedToVarchar: string,
	extra: Record<string, string> = {}
): Record<string, string> {
	return {
		// Expose unsupported source types (enums, geometry, etc.) as VARCHAR instead of
		// hiding them from information_schema / SELECT *.
		'unsupported-type-handling': 'CONVERT_TO_VARCHAR',
		'jdbc-types-mapped-to-varchar': jdbcTypesMappedToVarchar,
		...extra
	};
}

/**
 * Extra Trino catalog WITH (...) properties so columns are queryable as VARCHAR where
 * Trino's default mapping breaks string/date comparisons or hides columns entirely.
 *
 * @see https://trino.io/docs/current/connector/clickhouse.html — clickhouse.map-string-as-varchar
 * @see https://trino.io/docs/current/connector/postgresql.html — jdbc-types-mapped-to-varchar
 */
export function catalogTypeMappingProperties(
	connectionType: ConnectionType
): Record<string, string> {
	switch (connectionType) {
		case 'clickhouse':
			return { 'clickhouse.map-string-as-varchar': 'true' };
		case 'postgres':
			return jdbcCatalogProperties('bytea');
		case 'mysql':
		case 'mariadb':
		case 'singlestore':
			return jdbcCatalogProperties('binary,varbinary,tinyblob,blob,mediumblob,longblob', {
				// DECIMAL(p,s) with p > 38 otherwise fails at runtime.
				'decimal-mapping': 'allow_overflow',
				'decimal-default-scale': '0'
			});
		case 'sqlserver':
			return jdbcCatalogProperties('binary,varbinary,image');
		case 'redshift':
			return jdbcCatalogProperties('varbinary,varbyte');
		case 'oracle':
			return jdbcCatalogProperties('raw,blob');
		case 'snowflake':
			return jdbcCatalogProperties('binary,varbinary');
		default:
			return {};
	}
}

/**
 * Per-query session overrides so type-mapping fixes apply to catalogs registered before
 * Lunapad started setting catalog properties. Comma-separated per Trino X-Trino-Session.
 */
export function catalogTypeMappingSession(
	catalogName: string,
	connectionType: ConnectionType
): string | undefined {
	const parts: string[] = [];
	if (connectionType === 'clickhouse') {
		parts.push(`${catalogName}.map_string_as_varchar=true`);
	}
	if (isJdbcConnectionType(connectionType)) {
		parts.push(`${catalogName}.unsupported_type_handling=CONVERT_TO_VARCHAR`);
	}
	return parts.length > 0 ? parts.join(',') : undefined;
}
