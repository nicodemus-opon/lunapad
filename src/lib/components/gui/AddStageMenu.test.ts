import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './AddStageMenu.svelte');

describe('AddStageMenu command palette layout', () => {
	it('uses dialog command palette with smart column-aware preset ranking', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain("import * as Dialog from '$lib/components/ui/dialog';");
		expect(source).toContain('presetSuggestions?: StagePresetSuggestion[];');
		expect(source).toContain('presetSuggestions: presetSuggestionsProp = []');
		expect(source).toContain('presetSuggestionsProp.length > 0');
		expect(source).toContain('searchPresets');
		expect(source).toContain('searchFunctionActions');
		expect(source).toContain('searchSemanticStageCombinations');
		expect(source).toContain('searchAnalysisPrompts');
		expect(source).toContain('matchedColumnForQuery');
		expect(source).toContain('queryMatchesPresetIntent');
		expect(source).toContain('detectExplicitStageIntent');
		expect(source).toContain('/\\btop\\s+\\d+\\b/.test(queryValue)');
		expect(source).toContain('/\\b(by|where|when|per|with)\\b/.test(queryValue)');
		expect(source).toContain('explicitStageIntent');
		expect(source).toContain('stageIntentResults');
		expect(source).toContain('STAGE_INTENT_PHRASES');
		expect(source).toContain('QUERY_FILLER_TOKENS');
		expect(source).toContain('group by');
		expect(source).toContain('order by');
		expect(source).toContain("{ type: 'from', aliases: ['from'] }");
		expect(source).toContain('queryLooksAnalytical');
		expect(source).toContain(
			'which|what|how many|most|least|highest|lowest|best|worst|longest|shortest|cheapest|farthest|expensive|spike|spikes|outlier|anomaly'
		);
		expect(source).toContain('[analysisLane, semanticLane, presetLane, stageLane, functionLane]');
		expect(source).toContain('meaningfulTokens');
		expect(source).toContain('earlyTokens');
		expect(source).toContain('if (/\\b(by|where|when|per|with)\\b/.test(queryValue)) return null;');
		expect(source).toContain('fallbackRankedSuggestions');
		expect(source).toContain('normalizedQuery.length === 0');
		expect(source).toContain('presetMentionsColumn');
		expect(source).toContain('Adapted for {matchedColumn}');
		expect(source).toContain('Prompt or search stages, templates, and columns...');
		expect(source).toContain(
			'No matching stage, function, semantic combination, analysis prompt, or preset'
		);
		expect(source).toContain('Stage palette');
		expect(source).toContain('Function results');
		expect(source).toContain('Stage primitives');
		expect(source).toContain('hasExplicitStageIntent');
		expect(source).toContain('nonFunctionResultCount');
		expect(source).toContain('Semantic combinations');
		expect(source).toContain('Analysis prompts');
		expect(source).toContain('Template chains');
		expect(source).toContain('Suggested for this pipeline');
		expect(source).toContain('quickChipsProp.length > 0 ? quickChipsProp : getQuickChips');
		expect(source).toContain('function normalizeStageSequence');
		expect(source).toContain("func: aggregation.func === 'avg' ? 'average' : aggregation.func");
		expect(source).not.toContain('Function bundles');
		expect(source).not.toContain('visiblePresetSuggestions.slice(0, 8)');
		expect(source).not.toContain('Popover.Root');
		expect(source).toContain('{#if normalizedQuery.length > 0}');
		expect(source).toContain('{#each queryLanes as lane (lane.key)}');
		expect(source).toContain("result.kind === 'analysis'");
		expect(source).toContain('Likely questions for this schema, translated into stage chains.');
		expect(source).toContain(
			'{#each filteredPresetSuggestions as suggestion, idx (suggestion.preset.id)}'
		);
		expect(source).toContain('add-stage-kind--preset');
	});
});
