import type { ChatIntent, TaskComplexity } from '$lib/services/ai-subagents.js';
import { classifyIntent, classifyComplexity } from '$lib/services/ai-subagents.js';

export interface RouteResult {
	intent: ChatIntent;
	complexity: TaskComplexity;
	loop: string;
	requiresPlanApproval: boolean;
	tier: 'forced' | 'regex' | 'classifier';
}

const CREATION_KEYWORDS =
	/\b(create|build|make|add|generate|new model|new cell|write a query|set up)\b/i;
const INVESTIGATE_KEYWORDS = /\b(explore|investigate|what does|look at)\b/i;

/**
 * Tiered intent router: forced mode → regex fast-path → lightweight classifier heuristics.
 * Tier 3 LLM micro-classifier can be added when llmConfig is available.
 */
export function routeAgentIntent(
	userText: string,
	forcedIntent?: 'build' | 'sprint' | 'fix' | 'dashboard' | 'explore'
): RouteResult {
	if (forcedIntent) {
		const intentMap = {
			build: 'creation',
			sprint: 'creation',
			fix: 'debug',
			dashboard: 'dashboard',
			explore: 'investigation'
		} as const;
		const intent = intentMap[forcedIntent];
		const complexity = forcedIntent === 'sprint' ? 'complex' : classifyComplexity(userText);
		const loop =
			intent === 'creation'
				? complexity === 'complex'
					? 'sprint'
					: 'pipeline'
				: intent === 'debug'
					? 'debug'
					: intent === 'dashboard'
						? 'dashboard'
						: intent === 'investigation'
							? 'investigation'
							: 'standard';
		return {
			intent,
			complexity,
			loop,
			requiresPlanApproval: intent === 'creation' && complexity !== 'complex',
			tier: 'forced'
		};
	}

	const regexIntent = classifyIntent(userText);
	if (regexIntent !== 'standard') {
		const complexity =
			regexIntent === 'creation' ? classifyComplexity(userText) : ('medium' as TaskComplexity);
		const loop =
			regexIntent === 'creation' ? (complexity === 'complex' ? 'sprint' : 'pipeline') : regexIntent;
		return {
			intent: regexIntent,
			complexity,
			loop,
			requiresPlanApproval: regexIntent === 'creation',
			tier: 'regex'
		};
	}

	// Tier 3 lightweight classifier (embedding-free heuristic)
	if (CREATION_KEYWORDS.test(userText) && !INVESTIGATE_KEYWORDS.test(userText)) {
		const complexity = classifyComplexity(userText);
		return {
			intent: 'creation',
			complexity,
			loop: complexity === 'complex' ? 'sprint' : 'pipeline',
			requiresPlanApproval: true,
			tier: 'classifier'
		};
	}
	if (INVESTIGATE_KEYWORDS.test(userText) && !CREATION_KEYWORDS.test(userText)) {
		return {
			intent: 'investigation',
			complexity: 'medium',
			loop: 'investigation',
			requiresPlanApproval: false,
			tier: 'classifier'
		};
	}

	return {
		intent: 'standard',
		complexity: 'medium',
		loop: 'standard',
		requiresPlanApproval: false,
		tier: 'regex'
	};
}
