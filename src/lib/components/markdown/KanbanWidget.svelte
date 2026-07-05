<script lang="ts">
	interface Props {
		data?: Record<string, unknown>[];
		groupBy: string;
		title: string;
		columns?: string[];
		description?: string;
		assignee?: string;
		priority?: string;
	}

	const { data = [], groupBy, title, columns, description, assignee, priority }: Props = $props();

	const PRIORITY_COLORS: Record<string, string> = {
		critical: 'kanban-p-critical',
		high: 'kanban-p-high',
		medium: 'kanban-p-medium',
		low: 'kanban-p-low'
	};

	const lanes = $derived.by(() => {
		const grouped = new Map<string, Record<string, unknown>[]>();
		for (const row of data) {
			const key = String(row[groupBy] ?? '—');
			if (!grouped.has(key)) grouped.set(key, []);
			grouped.get(key)!.push(row);
		}
		// Use explicit column order if provided, then append any unseen keys
		const order = columns ?? [...grouped.keys()];
		const seen = new Set(order);
		for (const k of grouped.keys()) if (!seen.has(k)) order.push(k);
		return order.map((name) => ({ name, cards: grouped.get(name) ?? [] }));
	});

	function initials(name: unknown): string {
		if (!name) return '?';
		return String(name)
			.split(/\s+/)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.slice(0, 2)
			.join('');
	}
</script>

<div class="kanban-board">
	{#each lanes as lane (lane.name)}
		<div class="kanban-lane">
			<div class="kanban-lane-header">
				<span class="kanban-lane-title">{lane.name}</span>
				<span class="kanban-lane-count">{lane.cards.length}</span>
			</div>
			<div class="kanban-cards">
				{#each lane.cards as card, i (i)}
					<div class="kanban-card">
						{#if priority && card[priority]}
							{@const p = String(card[priority]).toLowerCase()}
							<span class="kanban-priority {PRIORITY_COLORS[p] ?? 'kanban-p-medium'}"
								>{card[priority]}</span
							>
						{/if}
						<div class="kanban-card-title">{card[title] ?? '—'}</div>
						{#if description && card[description]}
							<div class="kanban-card-desc">{card[description]}</div>
						{/if}
						{#if assignee && card[assignee]}
							<div class="kanban-card-footer">
								<span class="kanban-avatar" title={String(card[assignee])}
									>{initials(card[assignee])}</span
								>
								<span class="kanban-assignee">{card[assignee]}</span>
							</div>
						{/if}
					</div>
				{/each}
				{#if lane.cards.length === 0}
					<div class="kanban-empty">No cards</div>
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.kanban-board {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		padding: 0.25rem 0 0.75rem;
		align-items: flex-start;
	}
	.kanban-lane {
		flex: 0 0 220px;
		display: flex;
		flex-direction: column;
		background: var(--muted);
		border: 1px solid var(--border);
		border-radius: var(--radius, 0.5rem);
		overflow: hidden;
	}
	.kanban-lane-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.7rem;
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklch, var(--accent) 40%, var(--muted));
	}
	.kanban-lane-title {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
	}
	.kanban-lane-count {
		font-size: 0.65rem;
		font-weight: 600;
		background: var(--background);
		color: var(--muted-foreground);
		border-radius: 9999px;
		padding: 0.1rem 0.45rem;
	}
	.kanban-cards {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem;
		min-height: 2.5rem;
	}
	.kanban-card {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius, 0.395rem) * 0.9);
		padding: 0.5rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		color: var(--card-foreground);
	}
	.kanban-card-title {
		font-size: 0.78rem;
		font-weight: 500;
		line-height: 1.35;
	}
	.kanban-card-desc {
		font-size: 0.7rem;
		color: var(--muted-foreground);
		line-height: 1.3;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.kanban-card-footer {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.1rem;
	}
	.kanban-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		background: color-mix(in oklch, var(--primary) 20%, transparent);
		color: var(--primary);
		font-size: 0.55rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.kanban-assignee {
		font-size: 0.68rem;
		color: var(--muted-foreground);
	}
	.kanban-priority {
		font-size: 0.62rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-radius: 0.25rem;
		padding: 0.08rem 0.35rem;
		align-self: flex-start;
	}
	.kanban-p-critical {
		background: color-mix(in oklch, var(--destructive) 15%, transparent);
		color: var(--destructive);
	}
	.kanban-p-high {
		background: color-mix(in oklch, var(--warning) 15%, transparent);
		color: var(--warning);
	}
	.kanban-p-medium {
		background: color-mix(in oklch, var(--primary) 15%, transparent);
		color: var(--primary);
	}
	.kanban-p-low {
		background: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
		color: var(--muted-foreground);
	}
	.kanban-empty {
		font-size: 0.68rem;
		color: var(--muted-foreground);
		opacity: 0.6;
		text-align: center;
		padding: 0.5rem 0;
	}
</style>
