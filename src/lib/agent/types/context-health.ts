export interface ContextHealthResponse {
	rag: boolean;
	memory: boolean;
	patterns: boolean;
	issues: string[];
	/** Present only when a `folder` was passed and the memory_embeddings table exists —
	 *  how many of that folder's recorded decisions/discoveries have an embedding yet. */
	memoryCoverage?: { embedded: number; total: number };
}
