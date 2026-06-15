export type SubagentType = 'discovery' | 'modeling' | 'sql-gen' | 'sql-review';

export interface DiscoveryResult {
	existingModels: Array<{ name: string; description: string }>;
	recommendedReuse: string[];
	nothingFound: boolean;
}

export interface ModelingPlan {
	modelName: string;
	materialization: 'table' | 'view' | 'incremental' | 'ephemeral';
	dependencies: string[];
	grain: string;
}

/** A data-specific acceptance criterion generated during the modeling phase. */
export interface PlanAssertion {
	/** outputName of the cell to check after it runs */
	model: string;
	/** SQL returning a scalar boolean (TRUE = pass). Query the cell by its outputName as a CTE. */
	sql: string;
	/** Human-readable description: "order_id is unique in stg_orders" */
	description: string;
}

export interface ReviewScores {
	correctness: number;  // 0-3: SQL runs? Grain matches? Assertions passed?
	completeness: number; // 0-3: Required columns? No unexpected nulls?
	performance: number;  // 0-2: Row count sane? No fan-out?
	convention: number;   // 0-2: Naming prefix? No WITH clauses? CTE style?
}

export interface ReviewResult {
	approved: boolean;
	scores?: ReviewScores;
	total?: number;
	warnings: string[];
	issues: string[];
}
