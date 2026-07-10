/**
 * Curated icon allowlist for AI-authored dashboard blocks (metric/card/callout `icon=` attrs).
 *
 * Framework-agnostic on purpose: generated-dashboard.ts validates against this list at compile
 * time on the server, while the client resolves the same names to @lucide/svelte components in
 * src/lib/components/markdown/icon-map.ts. A sync test in generated-dashboard.test.ts keeps the
 * two in lockstep (same pattern as FILTER_KINDS ↔ filter tag `kind.matches`).
 *
 * Names are lucide PascalCase export names. The set is deliberately small and concept-oriented
 * (finance, people, logistics, transport, place, status, eco) — enough to anchor stat rows and
 * pictograms without turning icon choice into a design decision the model can get wrong.
 */
export const DASHBOARD_ICON_NAMES = [
	// Trends & measurement
	'TrendingUp',
	'TrendingDown',
	'Activity',
	'Gauge',
	'Percent',
	'Target',
	'BarChart3',
	'PieChart',
	// People & commerce
	'Users',
	'DollarSign',
	'CreditCard',
	'ShoppingCart',
	'Building2',
	'Award',
	'Star',
	'Heart',
	// Logistics & transport
	'Package',
	'Truck',
	'Plane',
	'Car',
	'Bus',
	'TrainFront',
	'Bike',
	'Ship',
	'Luggage',
	// Place & time
	'Home',
	'MapPin',
	'Globe',
	'Calendar',
	'Clock',
	'Flag',
	// Status & systems
	'AlertTriangle',
	'CheckCircle2',
	'XCircle',
	'Database',
	'Zap',
	'Eye',
	'Mail',
	'Rocket',
	// Eco
	'Droplets',
	'Leaf',
	'TreePine'
] as const;

export type DashboardIconName = (typeof DASHBOARD_ICON_NAMES)[number];

const ICON_NAME_SET: ReadonlySet<string> = new Set(DASHBOARD_ICON_NAMES);

export function isDashboardIconName(name: unknown): name is DashboardIconName {
	return typeof name === 'string' && ICON_NAME_SET.has(name);
}
