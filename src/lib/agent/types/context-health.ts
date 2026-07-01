export interface ContextHealthResponse {
	rag: boolean;
	memory: boolean;
	patterns: boolean;
	issues: string[];
}
