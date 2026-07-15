// The demo's actual "script" — one ordered list of beats, grouped into chapters.
// Each beat is content (what to show/say) *and* a live selector-driving function, so this
// file can never drift from what's actually recorded the way the old hand-written
// fast-demo-script.md / full-walkthrough-script.md prose did (see record.mjs --print-script).
//
// Beats receive `{ page, a, o, holdMs }`: `page` is the raw Playwright page (use directly
// for one-off selectors); `a` is actions.mjs and `o` is overlay.mjs, both pre-bound to this
// beat's page by record.mjs's bindPage() so every call below omits the `page` argument
// their standalone exports normally take; `holdMs` is this beat's computed trailing-pause
// budget (see computeHoldMs below) — record.mjs computes it from the beat's own metadata
// before calling run(), so a beat never hand-picks its own hold time.
//
// `pace` still exists as a tag (`'quick' | 'normal' | 'lingering'`) but no longer scales
// footage playback speed or gates a fixed pause — it only feeds computeHoldMs's multiplier
// and (in record.mjs) whether the beat gets a camera push at all ('quick' beats hold static,
// on the theory that they already have real cursor motion + the app's own UI transitions,
// and a beat that's all cuts and no zooms is itself real shot variety).
//
// Each beat's run(ctx) may return a focus rect ({x,y,width,height} in viewport pixels, via
// a.focusRect/a.cellFocusRect) — record.mjs uses that to drive the camera push-in in
// zoom.mjs (for non-'quick' beats). Returning nothing/null means "no camera move."

// ---- hold-time formula -------------------------------------------------------------
// Replaces what used to be a hand-picked millisecond value per beat, chosen once during
// fast iteration and never revisited — which is exactly why the real output ended up at
// 13s/36s total instead of anything a viewer could actually follow. Every constant below
// is independently justified (see the plan doc), not fit backwards from a target length.
const FLOOR_MS = 900; // click/keystroke registers + settles
const WORD_MS = 230; // ~4.3 words/sec — slower than pure subtitle reading, since the
// viewer is also tracking real UI motion, not just text
const ACTION_BUFFER_MS = 400; // per sub-action beyond the first, budgeted into the total
const OUTCOME_BONUS_MS = 1100; // extra dwell when the beat ends on a result to read
const DEAD_AIR_MS = 350; // fixed trailing beat, added after the pace multiplier —
// never compressed, every beat gets a breath before the cut
const PACE_MULT = { quick: 0.75, normal: 1.0, lingering: 1.4 };

// Fixed, smaller inter-action pause used *during* a beat's own sub-actions (see individual
// run()s below) — deliberately less than ACTION_BUFFER_MS so the difference rolls into the
// beat's final trailing hold instead: the payoff at the end of a beat should get most of
// the dwell, not the first click in a sequence.
export const INTER_ACTION_MS = 280;

function wordCount(strings) {
	return strings.join(' ').trim().split(/\s+/).filter(Boolean).length;
}

// Computes this beat's total on-screen hold budget. Call once per beat (record.mjs does
// this right before invoking run()); a beat's own run() then spends INTER_ACTION_MS between
// its sub-actions and puts whatever's left of this budget into one trailing pause at the end.
export function computeHoldMs(beat) {
	const words = wordCount(beat.captions ?? []);
	const extraActions = beat.extraActions ?? 0;
	const outcome = beat.outcome ? 1 : 0;
	const base = FLOOR_MS + WORD_MS * words + ACTION_BUFFER_MS * extraActions + OUTCOME_BONUS_MS * outcome;
	const mult = PACE_MULT[beat.pace] ?? 1;
	return Math.round(base * mult + DEAD_AIR_MS);
}

// A beat's trailing pause after spending INTER_ACTION_MS between its own sub-actions —
// floored so a beat with an unusually large extraActions count never goes negative.
function trailingMs(holdMs, extraActions = 0) {
	return Math.max(500, holdMs - INTER_ACTION_MS * extraActions);
}

export const GROWTH_SQL = `SELECT
  month,
  total_revenue,
  total_revenue - LAG(total_revenue) OVER (ORDER BY month) AS mom_delta,
  ROUND(100.0 * (total_revenue - LAG(total_revenue) OVER (ORDER BY month))
        / NULLIF(LAG(total_revenue) OVER (ORDER BY month), 0), 1) AS mom_pct
FROM monthly_revenue
WHERE total_revenue > 0
ORDER BY month`;

export const beats = [
	// ---------------------------------------------------------------- intro
	{
		id: 'title',
		chapter: 'intro',
		modes: ['fast', 'full'],
		pace: 'normal',
		async run({ o }) {
			await o.titleCard('Notebooks, not boilerplate SQL', 'PRQL or SQL, your call');
			await o.pause(2600);
			await o.hideTitleCard();
		}
	},
	{
		id: 'template-gallery',
		chapter: 'intro',
		modes: ['fast', 'full'],
		pace: 'normal',
		captions: ['Start from a template, not a blank page'],
		extraActions: 1,
		outcome: false,
		async run({ a, o, holdMs }) {
			await o.caption('Start from a template, not a blank page');
			await o.park();
			await a.openTemplateGalleryAndPick();
			await o.pause(trailingMs(holdMs, 1));
			return null;
		}
	},
	{
		// Deliberate on-camera flourish: shows a real shortcut *and* is the actual mechanism
		// that keeps the sidebar off-screen for the rest of this chapter. record.mjs skips
		// its own silent collapseSidebar() call for the intro chapter specifically so this
		// single Meta+b toggle isn't immediately undone by a second press.
		id: 'sidebar-flourish',
		chapter: 'intro',
		modes: ['fast', 'full'],
		pace: 'normal',
		captions: ['More room when you need it'],
		extraActions: 0,
		outcome: false,
		async run({ a, o, holdMs }) {
			await o.caption('More room when you need it');
			await o.keyflash(['⌘', 'B'], 'Meta+b');
			await o.pause(trailingMs(holdMs));
			return null;
		}
	},

	// ---------------------------------------------------------------- core
	{
		id: 'run-all',
		chapter: 'core',
		modes: ['fast', 'full'],
		pace: 'quick',
		captions: ['Run all cells: tables, charts, stats, dashboard widgets'],
		extraActions: 0,
		outcome: true,
		async run({ a, o, holdMs }) {
			await o.caption('Run all cells: tables, charts, stats, dashboard widgets');
			await a.runAllCells();
			const rect = await a.cellFocusRect('orders');
			await o.pause(trailingMs(holdMs));
			return rect;
		}
	},
	{
		id: 'sql-live-edit',
		chapter: 'core',
		modes: ['fast', 'full'],
		pace: 'lingering',
		captions: ['Standard SQL — cells reference each other by name', 'Live-edit + rerun'],
		extraActions: 1,
		outcome: true,
		async run({ a, o, holdMs }) {
			await o.caption('Standard SQL — cells reference each other by name');
			const rect = await a.cellFocusRect('growth_analysis');
			await a.editCellCode('growth_analysis', GROWTH_SQL);
			await o.caption('Live-edit + rerun');
			await o.pause(INTER_ACTION_MS);
			await a.runCellByName('growth_analysis');
			await o.pause(trailingMs(holdMs, 1));
			return rect;
		}
	},
	{
		id: 'result-views',
		chapter: 'core',
		modes: ['fast', 'full'],
		pace: 'quick',
		captions: ['Same result, different lenses: Stats → Table → Chart'],
		extraActions: 2,
		outcome: true,
		async run({ a, o, holdMs }) {
			await o.caption('Same result, different lenses: Stats → Table → Chart');
			const rect = await a.cellFocusRect('orders');
			await a.switchResultView('orders', 'stats');
			await o.pause(INTER_ACTION_MS);
			await a.switchResultView('orders', 'table');
			await o.pause(INTER_ACTION_MS);
			await a.switchResultView('orders', 'chart');
			await o.pause(trailingMs(holdMs, 2));
			return rect;
		}
	},
	{
		id: 'gui-pipeline',
		chapter: 'core',
		modes: ['fast', 'full'],
		pace: 'normal',
		captions: ['Optional visual pipeline builder — joins and groups, not just filters'],
		extraActions: 1,
		outcome: false,
		async run({ a, o, holdMs }) {
			await o.caption('Optional visual pipeline builder — joins and groups, not just filters');
			const cellId = await a.scrollToCell('region_performance');
			const cell = a.cellLocator(cellId);
			// The PRQL/Visual/SQL mode tabs are role="tab" (not "button") and are
			// opacity-0/pointer-events-none until the cell is hovered/focused, same
			// hover-reveal pattern as the result-view switcher.
			await cell.hover();
			await cell.getByRole('tab', { name: 'PRQL' }).click();
			await o.pause(INTER_ACTION_MS);
			await cell.getByRole('tab', { name: 'Visual' }).click();
			await o.pause(trailingMs(holdMs, 1));
			return a.focusRect(cell);
		}
	},
	{
		id: 'dashboard-filter',
		chapter: 'core',
		modes: ['fast', 'full'],
		pace: 'normal',
		captions: ['Live dashboard filters, not static screenshots'],
		extraActions: 1,
		outcome: true,
		async run({ page, a, o, holdMs }) {
			await o.caption('Live dashboard filters, not static screenshots');
			await a.scrollToCell('region_filtered_orders');
			await page
				.locator('text=Explore by region')
				.first()
				.scrollIntoViewIfNeeded()
				.catch(() => {});
			await o.pause(INTER_ACTION_MS);
			await a.changeRegionFilter('West');
			const select = page.locator('.md-filter').filter({ hasText: 'Region' }).first();
			await o.pause(trailingMs(holdMs, 1));
			return a.focusRect(select);
		}
	},

	// ---------------------------------------------------------------- power (full only)
	{
		id: 'command-palette',
		chapter: 'power',
		modes: ['full'],
		pace: 'quick',
		captions: ['⌘K jumps anywhere — notebooks, cells, actions'],
		extraActions: 1,
		outcome: false,
		async run({ page, o, holdMs }) {
			await o.keyflash(['⌘', 'K'], 'Meta+k');
			await page.keyboard.type('region', { delay: 60 });
			await o.caption('⌘K jumps anywhere — notebooks, cells, actions');
			await o.pause(INTER_ACTION_MS);
			await page.keyboard.press('Escape');
			await o.pause(trailingMs(holdMs, 1));
			return null;
		}
	},
	{
		id: 'upload-csv',
		chapter: 'power',
		modes: ['full'],
		pace: 'normal',
		captions: ['Upload real data — actual app upload dialog'],
		extraActions: 2,
		outcome: true,
		async run({ page, a, o, holdMs }) {
			await o.caption('Upload real data — actual app upload dialog');
			await page
				.getByRole('button', { name: 'Upload file' })
				.click()
				.catch(() => {});
			const csvPath = await a.ensureUploadFixture();
			await page
				.locator('input[type="file"]')
				.setInputFiles(csvPath)
				.catch(() => {});
			await o.pause(INTER_ACTION_MS);
			await page
				.getByRole('button', { name: /^Upload$/ })
				.click()
				.catch(() => {});
			await o.pause(trailingMs(holdMs, 2));
			await page.keyboard.press('Escape');
			return null;
		}
	},
	{
		id: 'connections',
		chapter: 'power',
		modes: ['full'],
		pace: 'normal',
		captions: ['Settings and external database connections'],
		extraActions: 2,
		outcome: true,
		async run({ page, a, o, holdMs }) {
			await o.caption('Settings and external database connections');
			await a.clickMenuItem('View', /Settings/);
			await o.pause(INTER_ACTION_MS);
			// SettingsDialog's sections are a plain sidebar <nav> of <button>s, not tabs.
			await page
				.getByRole('button', { name: 'Connections' })
				.click()
				.catch(() => {});
			await o.pause(INTER_ACTION_MS);
			await o.featureCard('External sources', [
				'Postgres, ClickHouse, and warehouse connections live here',
				'Queries stay read-only on server-backed connections'
			]);
			await o.pause(trailingMs(holdMs, 2));
			await o.hideFeatureCard();
			await page.keyboard.press('Escape');
			return null;
		}
	},
	{
		id: 'python-cell',
		chapter: 'power',
		modes: ['full'],
		pace: 'normal',
		captions: ['Python cells for richer analysis'],
		extraActions: 1,
		outcome: true,
		async run({ a, o, holdMs }) {
			await o.caption('Python cells for richer analysis');
			const canAdd = await a.canAddPythonCell();
			await o.pause(INTER_ACTION_MS);
			if (canAdd) {
				const cellId = await a.addPythonCell();
				if (cellId) {
					const cell = a.cellLocator(cellId);
					await cell.scrollIntoViewIfNeeded();
					await o.featureCard('Python cell ready', [
						'Server-side Python worker is available',
						'pandas / Plotly against notebook results'
					]);
					await o.pause(trailingMs(holdMs, 1));
					await o.hideFeatureCard();
					return a.focusRect(cell);
				}
			}
			await o.featureCard('Python cells, gated intentionally', [
				'Requires a project folder on disk',
				'Unlocks automatically in full project mode'
			]);
			await o.pause(trailingMs(holdMs, 1));
			await o.hideFeatureCard();
			return null;
		}
	},
	{
		id: 'ai-assistant',
		chapter: 'power',
		modes: ['full'],
		pace: 'lingering',
		captions: ['AI assistant — build and fix models, in the real chat panel'],
		extraActions: 1,
		outcome: true,
		async run({ a, o, holdMs }) {
			await o.caption('AI assistant — build and fix models, in the real chat panel');
			await a.openAiPanel();
			await o.pause(INTER_ACTION_MS);
			await a.sendAiPrompt('Add month-over-month percent change to growth_analysis');
			await o.pause(trailingMs(holdMs, 1));
			return null;
		}
	},
	{
		id: 'review-inbox',
		chapter: 'power',
		modes: ['full'],
		pace: 'quick',
		captions: ['Comments and review, right in the notebook'],
		extraActions: 0,
		outcome: false,
		async run({ page, o, holdMs }) {
			await o.caption('Comments and review, right in the notebook');
			await page
				.getByRole('button', { name: 'Open review inbox' })
				.click()
				.catch(() => {});
			await o.pause(trailingMs(holdMs));
			await page.keyboard.press('Escape');
			return null;
		}
	},
	{
		id: 'share',
		chapter: 'power',
		modes: ['full'],
		pace: 'normal',
		captions: ['Publish a shareable report link'],
		extraActions: 1,
		outcome: true,
		async run({ page, a, o, holdMs }) {
			await o.caption('Publish a shareable report link');
			await a.clickMenuItem('View', /Share/);
			await o.pause(INTER_ACTION_MS);
			await page
				.getByRole('button', { name: /Publish/i })
				.click()
				.catch(() => {});
			await o.pause(trailingMs(holdMs, 1));
			await page.keyboard.press('Escape');
			return null;
		}
	},
	{
		id: 'sites',
		chapter: 'power',
		modes: ['full'],
		pace: 'quick',
		captions: ['Group reports into a multi-page site'],
		extraActions: 0,
		outcome: false,
		async run({ page, a, o, holdMs }) {
			await o.caption('Group reports into a multi-page site');
			await a.clickMenuItem('View', /Sites/);
			await o.pause(trailingMs(holdMs));
			await page.keyboard.press('Escape');
			return null;
		}
	},
	{
		id: 'dbt',
		chapter: 'power',
		modes: ['full'],
		// Retagged from 'quick' — this is a dense feature-card explanation to read, not a
		// rapid transition, and it was quietly eating 32s in one run when its selector
		// broke; 'normal' pacing plus the fixed hold formula avoids relying on luck either way.
		pace: 'normal',
		captions: ['dbt appears the moment a project folder is open'],
		extraActions: 0,
		outcome: true,
		async run({ o, holdMs }) {
			await o.caption('dbt appears the moment a project folder is open');
			await o.featureCard('dbt project mode', [
				'Promote cells into real model files',
				'Compile, run, test, and inspect lineage'
			]);
			await o.pause(trailingMs(holdMs));
			await o.hideFeatureCard();
			return null;
		}
	},

	// ---------------------------------------------------------------- closing
	{
		id: 'report-view',
		chapter: 'closing',
		modes: ['fast', 'full'],
		pace: 'lingering',
		captions: ['Report view — hide the code, ship the dashboard'],
		extraActions: 0,
		outcome: true,
		async run({ a, o, holdMs }) {
			await o.caption('Report view — hide the code, ship the dashboard');
			await a.setReportView(true);
			await o.pause(trailingMs(holdMs));
			return null;
		}
	},
	{
		id: 'end-card',
		chapter: 'closing',
		modes: ['fast', 'full'],
		pace: 'normal',
		async run({ o }) {
			await o.titleCard('Lunapad', 'SQL notebooks → live dashboards → shared reports');
			await o.pause(2800);
			return null;
		}
	}
];

export function beatsFor(mode, chapter) {
	return beats.filter((b) => b.modes.includes(mode) && (!chapter || b.chapter === chapter));
}

export const CHAPTERS = ['intro', 'core', 'power', 'closing'];
