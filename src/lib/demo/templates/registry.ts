import { salesAnalyticsTemplate, executiveKpiTemplate } from './sales-analytics';
import { marketingFunnelTemplate } from './marketing-funnel';
import { productWebEventsTemplate } from './product-web-events';
import { financeExpensesTemplate } from './finance-expenses';
import { supportTicketsTemplate } from './support-tickets';
import { sqlPlaygroundTemplate } from './sql-playground';
import { prqlExplorationTemplate } from './prql-exploration';
import { pythonAnalysisTemplate } from './python-analysis';
import { blankReportTemplate } from './blank-report';
import { meetingNotesTemplate } from './meeting-notes';
import type { DashboardTemplate, TemplateCategoryGroup } from './types';

// Adding a new template: create one file exporting a `DashboardTemplate` (see
// any file in this directory for the pattern), then add it to the relevant
// category below. No other file needs to change.
export const TEMPLATE_CATEGORIES: TemplateCategoryGroup[] = [
	{
		id: 'analytics',
		label: 'Analytics',
		templates: [
			salesAnalyticsTemplate,
			executiveKpiTemplate,
			marketingFunnelTemplate,
			productWebEventsTemplate,
			financeExpensesTemplate,
			supportTicketsTemplate
		]
	},
	{
		id: 'starters',
		label: 'Starters',
		templates: [
			sqlPlaygroundTemplate,
			prqlExplorationTemplate,
			pythonAnalysisTemplate,
			blankReportTemplate,
			meetingNotesTemplate
		]
	}
];

export function getDashboardTemplate(id: string): DashboardTemplate | undefined {
	for (const group of TEMPLATE_CATEGORIES) {
		const found = group.templates.find((t) => t.id === id);
		if (found) return found;
	}
	return undefined;
}

export type { DashboardTemplate, TemplateCategory, TemplateCategoryGroup } from './types';
