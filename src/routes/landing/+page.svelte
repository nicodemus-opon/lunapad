<script lang="ts">
	import { onMount } from 'svelte';
	import '@fontsource-variable/inter';

	onMount(() => {
		// Nav: transparent on cyan hero → dark when scrolled past
		const nav = document.querySelector<HTMLElement>('.lp-nav');
		const hero = document.querySelector<HTMLElement>('.hero');

		const onScroll = () => {
			if (!hero || !nav) return;
			nav.classList.toggle('nav--scrolled', window.scrollY > hero.offsetHeight - 30);
		};

		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();

		// Scroll-triggered opacity reveals (no translateY — elements don't bounce in)
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!reduced) {
			const io = new IntersectionObserver(
				(entries) => {
					entries.forEach((e) => {
						if (e.isIntersecting) {
							(e.target as HTMLElement).style.opacity = '1';
							io.unobserve(e.target);
						}
					});
				},
				{ threshold: 0.08 }
			);

			document.querySelectorAll<HTMLElement>('.reveal').forEach((el) => {
				el.style.opacity = '0';
				el.style.transition = 'opacity 0.4s ease';
				io.observe(el);
			});

			return () => {
				window.removeEventListener('scroll', onScroll);
				io.disconnect();
			};
		}

		return () => window.removeEventListener('scroll', onScroll);
	});
</script>

<svelte:head>
	<title>Lunapad — The SQL notebook that wires itself</title>
	<meta
		name="description"
		content="Name a cell. Any other cell can query it like a table. Studio handles the CTE wiring, runs against DuckDB locally or your warehouse, and shows results inline. No install, no CLI."
	/>
</svelte:head>

<div class="dark lp-root">
	<!-- ── Nav ───────────────────────────────────────────────────────── -->
	<nav class="lp-nav" aria-label="Main navigation">
		<div class="nav-inner">
			<a href="/" class="nav-logo">
				<svg class="logo-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 600 600" aria-hidden="true">
					<rect width="600" height="600" fill="#b9e6fe" rx="120"/>
					<g transform="translate(100,100) scale(16.6667)" fill="none" stroke="#020202" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="3"/>
						<circle cx="19" cy="5" r="2"/>
						<circle cx="5" cy="19" r="2"/>
						<path d="M10.4 21.9a10 10 0 0 0 9.941-15.416"/>
						<path d="M13.5 2.1a10 10 0 0 0-9.841 15.416"/>
					</g>
				</svg>
				<span class="logo-text">Lunapad</span>
			</a>
			<div class="nav-links">
				<a href="/docs" class="nav-link">Docs</a>
				<a href="https://github.com" class="nav-link nav-link--icon" aria-label="GitHub">
					<svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
						<path
							d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
						/>
					</svg>
				</a>
				<a href="/" class="btn btn-open-app">Open app</a>
			</div>
		</div>
	</nav>

	<main>
		<!-- ── Hero ──────────────────────────────────────────────────────── -->
		<section class="hero">
			<!-- Product-relevant doodles: cell pipeline · data table · bar chart · SELECT * -->
			<svg class="hero-doodles" aria-hidden="true" viewBox="0 0 1440 500" fill="none"
				stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
				xmlns="http://www.w3.org/2000/svg">

				<!-- ① Cell pipeline — two notebook cells linked by an arrow -->
				<rect x="70" y="195" width="118" height="44" rx="10" stroke-width="1.6"/>
				<line x1="92" y1="212" x2="124" y2="212" stroke-width="1.4"/>
				<line x1="92" y1="224" x2="152" y2="224" stroke-width="1.4"/>
				<text x="200" y="221" font-size="13" font-family="'Inter Variable',system-ui,sans-serif" fill="currentColor" stroke="none">cell 1</text>
				<line x1="129" y1="239" x2="129" y2="282" stroke-width="1.5"/>
				<polyline points="121,274 129,284 137,274" stroke-width="1.5"/>
				<rect x="70" y="288" width="118" height="44" rx="10" stroke-width="1.6"/>
				<line x1="92" y1="305" x2="152" y2="305" stroke-width="1.4"/>
				<line x1="92" y1="317" x2="130" y2="317" stroke-width="1.4"/>
				<text x="200" y="314" font-size="13" font-family="'Inter Variable',system-ui,sans-serif" fill="currentColor" stroke="none">cell 2</text>

				<!-- ② Data table — 3 cols × 4 rows with hatched header -->
				<rect x="402" y="228" width="178" height="172" rx="2" stroke-width="1.4"/>
				<line x1="461" y1="228" x2="461" y2="400" stroke-width="1.2"/>
				<line x1="520" y1="228" x2="520" y2="400" stroke-width="1.2"/>
				<line x1="402" y1="270" x2="580" y2="270" stroke-width="1.4"/>
				<line x1="402" y1="313" x2="580" y2="313" stroke-width="1.0"/>
				<line x1="402" y1="356" x2="580" y2="356" stroke-width="1.0"/>
				<!-- header hatching -->
				<line x1="415" y1="234" x2="436" y2="269" stroke-width="0.9"/>
				<line x1="424" y1="232" x2="451" y2="269" stroke-width="0.9"/>
				<line x1="473" y1="233" x2="495" y2="269" stroke-width="0.9"/>
				<line x1="482" y1="232" x2="511" y2="269" stroke-width="0.9"/>
				<line x1="532" y1="233" x2="554" y2="269" stroke-width="0.9"/>
				<line x1="541" y1="232" x2="570" y2="269" stroke-width="0.9"/>
				<!-- data rows: short dashes -->
				<line x1="415" y1="292" x2="450" y2="292" stroke-width="1.1"/>
				<line x1="473" y1="292" x2="512" y2="292" stroke-width="1.1"/>
				<line x1="532" y1="292" x2="566" y2="292" stroke-width="1.1"/>
				<line x1="415" y1="335" x2="442" y2="335" stroke-width="1.1"/>
				<line x1="473" y1="335" x2="508" y2="335" stroke-width="1.1"/>
				<line x1="532" y1="335" x2="571" y2="335" stroke-width="1.1"/>
				<line x1="415" y1="378" x2="453" y2="378" stroke-width="1.1"/>
				<line x1="473" y1="378" x2="506" y2="378" stroke-width="1.1"/>
				<line x1="532" y1="378" x2="563" y2="378" stroke-width="1.1"/>

				<!-- ③ Bar chart — 3 bars, hatched, ascending -->
				<line x1="718" y1="210" x2="718" y2="408" stroke-width="1.5"/>
				<line x1="718" y1="408" x2="882" y2="408" stroke-width="1.5"/>
				<!-- bar 1 short -->
				<rect x="734" y="362" width="36" height="46" rx="1" stroke-width="1.4"/>
				<line x1="736" y1="406" x2="758" y2="363" stroke-width="0.9"/>
				<line x1="743" y1="407" x2="769" y2="365" stroke-width="0.9"/>
				<line x1="752" y1="407" x2="769" y2="378" stroke-width="0.9"/>
				<!-- bar 2 medium -->
				<rect x="792" y="298" width="36" height="110" rx="1" stroke-width="1.4"/>
				<line x1="793" y1="406" x2="815" y2="364" stroke-width="0.9"/>
				<line x1="793" y1="392" x2="827" y2="318" stroke-width="0.9"/>
				<line x1="800" y1="407" x2="827" y2="352" stroke-width="0.9"/>
				<line x1="808" y1="407" x2="827" y2="372" stroke-width="0.9"/>
				<line x1="816" y1="407" x2="827" y2="392" stroke-width="0.9"/>
				<!-- bar 3 tall -->
				<rect x="850" y="235" width="36" height="173" rx="1" stroke-width="1.4"/>
				<line x1="851" y1="406" x2="873" y2="362" stroke-width="0.9"/>
				<line x1="851" y1="390" x2="885" y2="312" stroke-width="0.9"/>
				<line x1="851" y1="374" x2="885" y2="268" stroke-width="0.9"/>
				<line x1="851" y1="358" x2="885" y2="248" stroke-width="0.9"/>
				<line x1="858" y1="407" x2="885" y2="332" stroke-width="0.9"/>
				<line x1="866" y1="407" x2="885" y2="352" stroke-width="0.9"/>
				<line x1="874" y1="407" x2="885" y2="374" stroke-width="0.9"/>

				<!-- ④ SELECT * with curved underline -->
				<text x="1068" y="318" font-size="30"
					font-family="Georgia,'Times New Roman',serif"
					font-style="italic" letter-spacing="3"
					fill="currentColor" stroke="none">SELECT *</text>
				<path d="M 1062 334 C 1130 350 1248 345 1348 329" stroke-width="1.8"/>
			</svg>

			<div class="container">
				<div class="hero-content">
					<h1>The SQL notebook<br />that wires itself.</h1>
					<p class="hero-sub">
						Name a cell. Any downstream cell can reference it like a table. Studio resolves the
						dependency graph, wires the CTEs, and runs the query: DuckDB in the browser, your
						warehouse, or both in a single federated join. Results inline. No install, no CLI.
					</p>
					<div class="hero-cta">
						<a href="/" class="btn btn-hero-primary">Start building, it's free</a>
						<a href="#how-it-works" class="btn btn-hero-ghost">See how it works</a>
					</div>
				</div>

				<div class="hero-preview" aria-hidden="true">
					<div class="preview-window">
						<div class="preview-bar">
							<span class="preview-dot preview-dot-red"></span>
							<span class="preview-dot preview-dot-yellow"></span>
							<span class="preview-dot preview-dot-green"></span>
							<span class="tab-label">monthly_revenue.sql</span>
						</div>
						<div class="preview-body">
							<div class="cell">
								<div class="cell-gutter">
									<div class="cell-run">
										<svg viewBox="0 0 8 8"><polygon points="2,1 7,4 2,7" /></svg>
									</div>
									<span class="cell-idx">1</span>
								</div>
								<div class="cell-content">
									<div class="cell-label">SQL · orders</div>
									<!-- prettier-ignore -->
									<pre class="cell-code"><span class="kw">select</span>
  customer_id,
  amount * quantity <span class="kw">as</span> revenue,
  created_at
<span class="kw">from</span> raw_orders
<span class="kw">where</span> status = <span class="str">'completed'</span></pre>
								</div>
							</div>
							<div class="cell">
								<div class="cell-gutter">
									<div class="cell-run cell-run--active">
										<svg viewBox="0 0 8 8"><polygon points="2,1 7,4 2,7" /></svg>
									</div>
									<span class="cell-idx">2</span>
								</div>
								<div class="cell-content">
									<div class="cell-label">SQL · monthly_revenue</div>
									<!-- prettier-ignore -->
									<pre class="cell-code"><span class="kw">select</span>
  <span class="fn">date_trunc</span>(<span class="str">'month'</span>, created_at) <span class="kw">as</span> month,
  <span class="fn">sum</span>(revenue)                    <span class="kw">as</span> total,
  <span class="fn">count</span>(<span class="kw">distinct</span> customer_id)     <span class="kw">as</span> customers
<span class="kw">from</span> orders  <span class="cm">-- cell 1 auto-resolved as CTE</span>
<span class="kw">group by</span> 1
<span class="kw">order by</span> 1 <span class="kw">desc</span></pre>
									<div class="cell-result">
										<table class="result-table">
											<thead>
												<tr><th>month</th><th>total</th><th>customers</th></tr>
											</thead>
											<tbody>
												<tr><td>2024-03-01</td><td>142,830.00</td><td>1,204</td></tr>
												<tr><td>2024-02-01</td><td>119,450.00</td><td>987</td></tr>
												<tr><td>2024-01-01</td><td>98,210.00</td><td>831</td></tr>
											</tbody>
										</table>
									</div>
								</div>
							</div>
						</div>
						<div class="preview-status">
							<span class="status-dot"></span>
							<span>3 rows · 47ms</span>
							<span class="status-sep">·</span>
							<span>orders → monthly_revenue</span>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- ── Features ───────────────────────────────────────────────────── -->
		<section class="features" id="features">
			<div class="container">
				<h2 class="section-title reveal">What you get</h2>

				<!-- Top: primary feature (left, 2fr) + 2 secondary stacked (right, 1fr) -->
				<div class="features-top reveal">
					<div class="feature-primary">
						<div class="feat-proof feat-proof--code" aria-hidden="true">
							<span class="fp-dim">-- monthly_revenue depends on orders</span>
							<span class="fp-line"
								><span class="fp-kw">from</span> orders<span class="fp-note"
									>  &larr; cell 1 &middot; auto-resolved as CTE</span
								></span
							>
						</div>
						<div class="feat-name">Cells are models</div>
						<div class="feat-desc">
							Name a cell. Reference it from any downstream cell by name, like a table. Studio
							resolves the full dependency graph and wraps each upstream output as a CTE on every
							run. Reference cells across notebooks to build a shared library of transforms. No
							manual wiring. No copy-paste.
						</div>
					</div>

					<div class="features-aside">
						<div class="feature-aside-item">
							<div class="feat-proof" aria-hidden="true">
								<span class="fp-timing"><span class="fp-timing-num">47</span>ms</span>
							</div>
							<div class="feat-name">Millisecond feedback</div>
							<div class="feat-desc">
								DuckDB runs as WebAssembly in your browser. Your files never leave your machine.
								Connect your warehouse for production queries, or work entirely offline. Either
								way, results appear under the cell in milliseconds.
							</div>
						</div>
						<div class="feature-aside-item">
							<div class="feat-proof" aria-hidden="true">
								<span class="fp-chips">
									<span class="fp-chip">DuckDB</span>
									<span class="fp-chip">Postgres</span>
									<span class="fp-chip">ClickHouse</span>
									<span class="fp-chip">Federated</span>
								</span>
							</div>
							<div class="feat-name">Any warehouse, any source</div>
							<div class="feat-desc">
								Upload a CSV, connect Postgres, write one query that joins them. Studio routes
								each segment to the right engine and returns a single result: no ETL, no staging
								tables. Schema-aware completions, read-only enforced.
							</div>
						</div>
					</div>
				</div>

				<!-- Middle: output features (dashboards, profiling, charts) -->
				<div class="features-power reveal">
					<div class="feature-item">
						<div class="feat-proof" aria-hidden="true">
							<span class="fp-chips">
								<span class="fp-chip"># 142k</span>
								<span class="fp-chip">&#x25BC; month</span>
								<span class="fp-chip">&#x258C; chart</span>
							</span>
						</div>
						<div class="feat-name">Interactive dashboards</div>
						<div class="feat-desc">
							Turn any notebook into a report. Drop filter controls (dropdowns, date ranges,
							button groups) that wire directly to queries via <code>${'{paramName}'}</code>.
							Text blocks pull live values with <code>{'{query.column}'}</code> interpolation.
							Set auto-refresh to 30 s, 1 min, or 5 min. No BI tool.
						</div>
					</div>
					<div class="feature-item">
						<div class="feat-proof" aria-hidden="true">
							<span class="fp-stat-row">
								<span class="fp-stat"><span class="fp-stat-num">2%</span> null</span>
								<span class="fp-sep">&middot;</span>
								<span class="fp-stat"><span class="fp-stat-num">142</span> p50</span>
								<span class="fp-sep">&middot;</span>
								<span class="fp-stat"><span class="fp-stat-num">38</span> distinct</span>
							</span>
						</div>
						<div class="feat-name">Every column, profiled instantly</div>
						<div class="feat-desc">
							Click profile on any result. Get null %, unique counts, min/max, quartiles
							(p25/p50/p75), mean, stddev, and top values for every column, in one pass. No
							COUNT DISTINCT queries, no separate EDA step.
						</div>
					</div>
					<div class="feature-item">
						<div class="feat-proof" aria-hidden="true">
							<span class="fp-types">
								<span class="fp-type">&#x258C; bar</span>
								<span class="fp-sep">&middot;</span>
								<span class="fp-type">&#x25A3; heatmap</span>
								<span class="fp-sep">&middot;</span>
								<span class="fp-type">&#x2B21; Sankey</span>
								<span class="fp-sep">&middot;</span>
								<span class="fp-type fp-type--more">+17</span>
							</span>
						</div>
						<div class="feat-name">20+ chart types, inline</div>
						<div class="feat-desc">
							Bar, line, area, scatter, bubble, pie, histogram, heatmap, calendar heatmap,
							funnel, box plot, Sankey. Each with X/Y/color/size column assignment, series mode
							(grouped or stacked), and custom titles. Rendered under the cell, no tab switch.
						</div>
					</div>
				</div>

				<!-- Bottom: workflow features -->
				<div class="features-workflow reveal">
					<div class="feature-item">
						<div class="feat-proof" aria-hidden="true">
							<span class="fp-pipeline">
								<span class="fp-stage">Filter</span><span class="fp-arrow">&#x2192;</span><span
									class="fp-stage">Group</span
								><span class="fp-arrow">&#x2192;</span><span class="fp-stage">Sort</span>
							</span>
						</div>
						<div class="feat-name">Visual pipeline editor</div>
						<div class="feat-desc">
							Drag Filter, Group, Sort, Join, Window stages onto the canvas. PRQL updates live.
							Run the pipeline up to any intermediate stage to inspect mid-transform results. Flip
							to code and keep editing.
						</div>
					</div>
					<div class="feature-item">
						<div class="feat-proof" aria-hidden="true">
							<span class="fp-cmd">&#x21BA; 60 min &rarr; prod.revenue</span>
						</div>
						<div class="feat-name">Scheduled materialization</div>
						<div class="feat-desc">
							Enable a schedule on any cell: 1 minute to 24 hours. Studio runs the cell and its
							upstream dependencies, then writes the result as a table or view to your warehouse.
							Cascade mode runs the full downstream graph automatically.
						</div>
					</div>
					<div class="feature-item">
						<div class="feat-proof" aria-hidden="true">
							<span class="fp-chips" style="align-items:center">
								<span class="fp-chip fp-chip--query">"revenue by country"</span>
								<span class="fp-arrow">&rarr;</span>
								<span class="fp-chip">PRQL</span>
							</span>
						</div>
						<div class="feat-name">Generate queries with AI</div>
						<div class="feat-desc">
							Describe what you want in plain text. Studio suggests a multi-stage PRQL pipeline
							with join paths, groupings, and aggregate functions inferred from your schema. Works
							with any OpenAI-compatible endpoint or Ollama locally.
						</div>
					</div>
					<div class="feature-item">
						<div class="feat-proof" aria-hidden="true">
							<span class="fp-cmd">$ dbt run</span>
						</div>
						<div class="feat-name">dbt-compatible</div>
						<div class="feat-desc">
							Open a project folder to compile, run, and test models. See the full lineage DAG:
							zoom, pan, click to jump to any model. Stream test results inline without leaving
							the notebook.
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- ── How it works ───────────────────────────────────────────────── -->
		<section class="flow-section" id="how-it-works">
			<div class="container">
				<h2 class="section-title reveal">How it works</h2>
				<div class="flow-layout">
					<!-- Left: dependency graph -->
					<div class="flow-visual reveal" aria-hidden="true">
						<div class="dag">
							<div class="dag-node dag-node--dim">
								<span class="dag-name">raw_orders</span>
								<span class="dag-type">csv upload</span>
							</div>
							<div class="dag-connector"></div>
							<div class="dag-node dag-node--active">
								<span class="dag-dot"></span>
								<span class="dag-name">orders</span>
								<span class="dag-type">cell 1</span>
							</div>
							<div class="dag-connector dag-connector--active"></div>
							<div class="dag-node dag-node--active">
								<span class="dag-dot"></span>
								<span class="dag-name">monthly_revenue</span>
								<span class="dag-type">cell 2</span>
							</div>
							<div class="dag-connector"></div>
							<div class="dag-node">
								<span class="dag-name">cohort_analysis</span>
								<span class="dag-type">cell 3</span>
							</div>
							<div class="dag-connector"></div>
							<div class="dag-node dag-node--target">
								<span class="dag-name">DuckDB · Postgres · S3</span>
								<span class="dag-type">target</span>
							</div>
						</div>
					</div>

					<!-- Right: steps -->
					<div class="flow-steps reveal">
						<div class="flow-step">
							<div class="step-num">01</div>
							<div class="step-body">
								<div class="step-title">Write SQL in a cell</div>
								<div class="step-desc">
									Each cell is a model with an output name. Downstream cells reference upstream ones
									by name — no manual CTE wiring.
								</div>
							</div>
						</div>
						<div class="flow-step">
							<div class="step-num">02</div>
							<div class="step-body">
								<div class="step-title">See results immediately</div>
								<div class="step-desc">
									Hit run. DuckDB executes locally, or the query goes to your warehouse — including
									cross-source joins without moving data. Results appear inline in under a second.
								</div>
							</div>
						</div>
						<div class="flow-step">
							<div class="step-num">03</div>
							<div class="step-body">
								<div class="step-title">Build up a model graph</div>
								<div class="step-desc">
									Chain cells into a full transformation pipeline. Studio assembles the WITH chain and
									runs only what changed.
								</div>
							</div>
						</div>
						<div class="flow-step">
							<div class="step-num">04</div>
							<div class="step-body">
								<div class="step-title">Connect to your stack</div>
								<div class="step-desc">
									Open a project folder to compile, run, and test models from the same interface.
									Works with dbt, or use Studio standalone — connect once and run SQL against any
									source without ETL.
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- ── CTA ────────────────────────────────────────────────────────── -->
		<section class="cta-section">
			<div class="container">
				<h2 class="cta-title reveal">Stop waiting on the CLI.</h2>
				<p class="cta-sub reveal">
					No install required. Upload a file or connect your warehouse and start querying in
					seconds. Build transformation pipelines, visualize with 20+ chart types, schedule
					materializations, and ship to dbt, all from the browser.
				</p>
				<div class="reveal">
					<a href="/" class="btn btn-cta">Start building — it's free</a>
				</div>
			</div>
		</section>
	</main>

	<!-- ── Footer ─────────────────────────────────────────────────────── -->
	<footer>
		<div class="container">
			<div class="footer-inner">
				<div class="footer-left">
					<span class="footer-wordmark">Lunapad</span>
					<span class="footer-copy">&copy; 2026</span>
				</div>
				<div class="footer-links">
					<a href="/docs">Docs</a>
					<a href="https://github.com">GitHub</a>
					<a href="/changelog">Changelog</a>
				</div>
			</div>
		</div>
	</footer>
</div>

<style>
	/* ── Font & local vars ─────────────────────────────────── */
	:root {
		--lp-font: 'Inter Variable', system-ui, sans-serif;
		--lp-r: 0.395rem;
	}

	/* ── Root wrapper — forces dark tokens for this page ───── */
	.lp-root {
		background: var(--background);
		color: var(--foreground);
		font-family: var(--lp-font);
		-webkit-font-smoothing: antialiased;
		min-height: 100dvh;
		overflow-x: hidden;
	}

	.container {
		max-width: 1120px;
		margin: 0 auto;
		padding: 0 24px;
	}

	/* ── Nav ───────────────────────────────────────────────── */
	.lp-nav {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 100;
		height: 56px;
		/* Same cyan as hero — nav merges with it, always fully opaque */
		background: var(--primary);
		border-bottom: 1px solid color-mix(in oklch, var(--primary-foreground) 10%, transparent);
		transition:
			background 220ms ease,
			border-color 220ms ease;
	}

	.lp-nav.nav--scrolled {
		background: var(--background);
		border-bottom-color: var(--border);
	}

	.nav-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 56px;
		max-width: 1120px;
		margin: 0 auto;
		padding: 0 24px;
	}

	.nav-logo {
		text-decoration: none;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.logo-icon {
		flex-shrink: 0;
	}

	.logo-text {
		font-family: var(--lp-font);
		font-weight: 700;
		font-size: 15px;
		letter-spacing: -0.02em;
		color: var(--primary-foreground);
		transition: color 180ms ease;
	}

	.lp-nav.nav--scrolled .logo-text {
		color: var(--accent-foreground);
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.nav-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px 12px;
		min-height: 44px;
		font-family: var(--lp-font);
		font-size: 14px;
		font-weight: 500;
		color: var(--primary-foreground);
		text-decoration: none;
		border-radius: var(--lp-r);
		opacity: 0.7;
		transition:
			opacity 120ms ease,
			color 180ms ease;
	}

	.nav-link:hover {
		opacity: 1;
	}

	.nav-link--icon {
		padding: 8px 10px;
	}

	.lp-nav.nav--scrolled .nav-link {
		color: var(--muted-foreground);
		opacity: 1;
	}

	.lp-nav.nav--scrolled .nav-link:hover {
		color: var(--foreground);
	}

	/* ── Buttons ───────────────────────────────────────────── */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 9px 18px;
		min-height: 40px;
		border-radius: var(--lp-r);
		font-family: var(--lp-font);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		border: none;
		white-space: nowrap;
		transition: opacity 120ms ease;
	}

	/* Nav — Open app: dark square on cyan, inverts after scroll */
	.btn-open-app {
		background: var(--primary-foreground);
		color: var(--primary);
		font-weight: 600;
		transition:
			opacity 120ms ease,
			background 180ms ease,
			color 180ms ease;
	}

	.btn-open-app:hover {
		opacity: 0.85;
	}

	.lp-nav.nav--scrolled .btn-open-app {
		background: var(--primary);
		color: var(--primary-foreground);
	}

	/* Hero — primary action: dark on cyan */
	.btn-hero-primary {
		background: var(--primary-foreground);
		color: var(--primary);
		font-size: 15px;
		font-weight: 600;
		padding: 11px 24px;
		min-height: 44px;
	}

	.btn-hero-primary:hover {
		opacity: 0.85;
	}

	/* Hero — ghost: near-black border and text on cyan */
	.btn-hero-ghost {
		background: var(--primary);
		color: var(--primary-foreground);
		border: 1px solid color-mix(in oklch, var(--primary-foreground) 28%, transparent);
		font-size: 15px;
		padding: 11px 24px;
		min-height: 44px;
	}

	.btn-hero-ghost:hover {
		opacity: 0.95;
	}

	/* CTA section — primary: cyan button on dark bg */
	.btn-cta {
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 15px;
		font-weight: 600;
		padding: 12px 28px;
		min-height: 48px;
	}

	.btn-cta:hover {
		opacity: 0.85;
	}

	/* ── Hero ──────────────────────────────────────────────── */
	.hero {
		background: var(--primary);
		overflow: hidden;
		padding-bottom: 0;
		position: relative;
	}

	.hero-doodles {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: auto; /* maintains 1440:500 aspect ratio, covers the cyan zone */
		pointer-events: none;
		z-index: 0;
		color: var(--primary-foreground);
		opacity: 0.15;
	}

	@media (max-width: 768px) {
		.hero-doodles { display: none; }
	}

	.hero > .container {
		position: relative;
		z-index: 1;
	}

	.hero > .container {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.hero-content {
		max-width: 820px;
		width: 100%;
		text-align: center;
		padding-top: 100px;
		padding-bottom: 52px;
		animation: lpFadeIn 0.38s ease both;
	}

	h1 {
		font-family: var(--lp-font);
		font-size: clamp(2.6rem, 5.5vw, 5rem);
		font-weight: 800;
		letter-spacing: -0.035em;
		line-height: 1.05;
		color: var(--primary-foreground);
		margin: 0 0 22px;
		text-wrap: balance;
	}

	.hero-sub {
		max-width: 500px;
		margin: 0 auto 36px;
		font-size: 18px;
		font-weight: 400;
		line-height: 1.6;
		color: color-mix(in oklch, var(--primary-foreground) 68%, transparent);
	}

	.hero-cta {
		display: flex;
		gap: 10px;
		justify-content: center;
		flex-wrap: wrap;
	}

	/* Preview panel: bleeds into dark section below */
	.hero-preview {
		width: 100%;
		animation: lpFadeIn 0.38s ease 0.14s both;
	}

	/* ── Preview window ────────────────────────────────────── */
	.preview-window {
		background: var(--background);
		border: 1px solid color-mix(in oklch, var(--primary-foreground) 14%, transparent);
		border-bottom: none;
		border-radius: 8px 8px 0 0;
		overflow: hidden;
		text-align: left;
	}

	.preview-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--sidebar);
	}

	.preview-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.preview-dot-red {
		background: #ff5f56;
	}
	.preview-dot-yellow {
		background: #ffbd2e;
	}
	.preview-dot-green {
		background: #27c93f;
	}

	.tab-label {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted-foreground);
		margin-left: 12px;
	}

	/* ── Cells ─────────────────────────────────────────────── */
	.cell {
		border-bottom: 1px solid var(--muted);
		display: grid;
		grid-template-columns: 40px 1fr;
	}

	.cell:last-child {
		border-bottom: none;
	}

	.cell-gutter {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 14px 0;
		gap: 6px;
		border-right: 1px solid var(--muted);
	}

	.cell-run {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cell-run--active {
		border-color: var(--primary);
		background: color-mix(in oklch, var(--primary) 12%, transparent);
	}

	.cell-run svg {
		width: 8px;
		height: 8px;
		fill: var(--muted-foreground);
	}

	.cell-run--active svg {
		fill: var(--primary);
	}

	.cell-idx {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted-foreground);
	}

	.cell-content {
		padding: 14px 18px;
	}

	.cell-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.07em;
		margin-bottom: 6px;
	}

	.cell-code {
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.7;
		color: var(--foreground);
		white-space: pre;
		margin: 0;
		background: none;
		border: none;
	}

	:global(.cell-code .kw) {
		color: var(--primary);
	}
	:global(.cell-code .fn) {
		color: oklch(0.811 0.111 293.571);
	}
	:global(.cell-code .str) {
		color: oklch(0.956 0.045 203.388);
	}
	:global(.cell-code .cm) {
		color: var(--muted-foreground);
		font-style: italic;
	}

	.cell-result {
		margin-top: 10px;
		border: 1px solid var(--muted);
		border-radius: var(--lp-r);
		overflow: hidden;
	}

	.result-table {
		width: 100%;
		border-collapse: collapse;
	}

	.result-table th {
		padding: 6px 12px;
		background: var(--sidebar);
		color: var(--muted-foreground);
		font-weight: 500;
		text-align: left;
		font-size: 11px;
		border-bottom: 1px solid var(--muted);
	}

	.result-table td {
		padding: 5px 12px;
		color: var(--foreground);
		border-bottom: 1px solid var(--muted);
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.result-table tr:last-child td {
		border-bottom: none;
	}

	.preview-status {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 16px;
		border-top: 1px solid var(--muted);
		background: var(--sidebar);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted-foreground);
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: oklch(0.77 0.17 143);
		flex-shrink: 0;
	}

	.status-sep {
		color: var(--border);
	}

	/* ── Features ──────────────────────────────────────────── */
	.features {
		padding: 80px 0 72px;
	}

	.section-title {
		font-family: var(--lp-font);
		font-size: clamp(1.5rem, 3vw, 2.2rem);
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--accent-foreground);
		line-height: 1.2;
		margin-bottom: 48px;
		text-wrap: balance;
	}

	/* ── Feature layout ─────────────────────────────────── */

	/* Top row: primary (2fr) + aside stack (1fr) */
	.features-top {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 64px;
		padding-bottom: 56px;
	}

	.feature-primary {
		padding: 0;
	}

	.features-aside {
		display: flex;
		flex-direction: column;
		gap: 40px;
	}

	.feature-aside-item {
		padding: 0;
	}

	.feature-item {
		padding: 0;
	}

	/* ── Feature anatomy ─────────────────────────────────── */

	.feat-proof {
		display: flex;
		align-items: center;
		min-height: 26px;
		margin-bottom: 18px;
	}

	.feat-proof--code {
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
	}

	.feat-name {
		font-family: var(--lp-font);
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--accent-foreground);
		line-height: 1.25;
		margin-bottom: 10px;
	}

	.feat-desc {
		font-family: var(--lp-font);
		font-size: 14px;
		font-weight: 400;
		color: var(--muted-foreground);
		line-height: 1.65;
	}

	/* ── Proof elements ──────────────────────────────────── */

	/* Code proof (primary feature) */
	.fp-dim {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--border);
		font-style: italic;
	}

	.fp-line {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--muted-foreground);
	}

	.fp-kw {
		color: var(--primary);
	}

	.fp-note {
		color: color-mix(in oklch, var(--primary) 55%, var(--muted-foreground));
		font-style: italic;
		font-size: 11px;
	}

	/* Timing metric */
	.fp-timing {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 500;
		color: var(--muted-foreground);
	}

	.fp-timing-num {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.04em;
		color: var(--primary);
	}

	/* Connection chips */
	.fp-chips {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
	}

	.fp-chip {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		color: var(--muted-foreground);
		background: var(--sidebar);
		border: 1px solid var(--border);
		border-radius: 3px;
		padding: 2px 7px;
	}

	/* Result type indicators */
	.fp-types {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted-foreground);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.fp-sep {
		color: var(--border);
	}

	/* Pipeline stages */
	.fp-pipeline {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.fp-stage {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		color: var(--muted-foreground);
		background: var(--sidebar);
		border: 1px solid var(--border);
		border-radius: 3px;
		padding: 2px 6px;
	}

	.fp-arrow {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--border);
	}

	/* dbt command */
	.fp-cmd {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted-foreground);
		background: var(--sidebar);
		border: 1px solid var(--border);
		border-radius: 3px;
		padding: 3px 10px;
	}

	/* ── Feature group separators (power + workflow rows) ─── */
	.features-power,
	.features-workflow {
		border-top: 1px solid var(--border);
		padding-top: 56px;
		margin-top: 56px;
	}

	/* Output row: 3-column grid */
	.features-power {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 48px;
	}

	/* Workflow row: 4-column grid */
	.features-workflow {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 40px;
	}

	/* Column profiling stat row */
	.fp-stat-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted-foreground);
	}

	.fp-stat {
		display: flex;
		align-items: baseline;
		gap: 3px;
	}

	.fp-stat-num {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: var(--primary);
	}

	/* "+17" more indicator on chart types */
	.fp-type--more {
		color: var(--primary);
		font-weight: 600;
	}

	/* AI query chip — italic for natural-language input */
	.fp-chip--query {
		font-style: italic;
		opacity: 0.8;
	}

	/* ── Flow ──────────────────────────────────────────────── */
	.flow-section {
		padding: 80px 0;
	}

	.flow-layout {
		display: grid;
		grid-template-columns: 1fr 280px;
		gap: 72px;
		align-items: start;
	}

	/* Steps on left */
	.flow-steps {
		order: 1;
	}

	/* DAG sticky on right */
	.flow-visual {
		order: 2;
		position: sticky;
		top: 88px;
	}

	/* ── Dependency graph ───────────────────────────────── */
	.dag {
		display: flex;
		flex-direction: column;
		align-items: stretch;
	}

	.dag-node {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 14px;
		border: 1px solid var(--border);
		border-radius: var(--lp-r);
		background: var(--sidebar);
	}

	.dag-node--active {
		border-color: var(--primary);
		background: color-mix(in oklch, var(--primary) 7%, var(--sidebar));
	}

	.dag-node--dim {
		opacity: 0.45;
	}

	.dag-node--target {
		border-style: dashed;
		opacity: 0.6;
	}

	.dag-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--primary);
		flex-shrink: 0;
	}

	.dag-name {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 500;
		color: var(--muted-foreground);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dag-node--active .dag-name {
		color: var(--accent-foreground);
	}

	.dag-type {
		font-family: var(--font-mono);
		font-size: 10px;
		color: color-mix(in oklch, var(--muted-foreground) 65%, transparent);
		flex-shrink: 0;
	}

	.dag-connector {
		width: 1px;
		height: 18px;
		background: var(--border);
		margin-left: 22px; /* aligns with center of nodes */
	}

	.dag-connector--active {
		background: var(--primary);
	}

	/* ── Steps ─────────────────────────────────────────── */
	.flow-step {
		display: grid;
		grid-template-columns: 52px 1fr;
		padding: 22px 0;
	}

	.step-num {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 400;
		color: var(--muted-foreground);
		padding-top: 3px;
	}

	.step-title {
		font-family: var(--lp-font);
		font-size: 14px;
		font-weight: 600;
		color: var(--accent-foreground);
		margin-bottom: 4px;
	}

	.step-desc {
		font-family: var(--lp-font);
		font-size: 13px;
		font-weight: 400;
		color: var(--muted-foreground);
		line-height: 1.55;
	}

	/* ── CTA ───────────────────────────────────────────────── */
	.cta-section {
		padding: 88px 0;
		text-align: center;
	}

	.cta-title {
		font-family: var(--lp-font);
		font-size: clamp(1.8rem, 4vw, 3rem);
		font-weight: 700;
		letter-spacing: -0.025em;
		color: var(--accent-foreground);
		margin: 0 0 14px;
		text-wrap: balance;
	}

	.cta-sub {
		font-family: var(--lp-font);
		font-size: 17px;
		font-weight: 400;
		color: var(--muted-foreground);
		max-width: 400px;
		margin: 0 auto 36px;
		line-height: 1.6;
	}

	/* ── Footer ────────────────────────────────────────────── */
	footer {
		border-top: 1px solid var(--border);
		background: var(--background);
		padding: 28px 0;
	}

	.footer-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}

	.footer-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.footer-wordmark {
		font-family: var(--lp-font);
		font-size: 13px;
		font-weight: 600;
		color: var(--muted-foreground);
	}

	.footer-copy {
		font-family: var(--lp-font);
		font-size: 13px;
		color: var(--muted-foreground);
	}

	.footer-links {
		display: flex;
		gap: 24px;
	}

	.footer-links a {
		font-family: var(--lp-font);
		font-size: 13px;
		color: var(--muted-foreground);
		text-decoration: none;
		padding-block: 12px;
		transition: color 120ms ease;
	}

	.footer-links a:hover {
		color: var(--foreground);
	}

	/* ── Animation ─────────────────────────────────────────── */
	@keyframes lpFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* ── Responsive ────────────────────────────────────────── */
	@media (max-width: 900px) {
		.flow-layout {
			grid-template-columns: 1fr;
			gap: 40px;
		}

		.flow-visual {
			position: static;
		}

		.dag {
			flex-direction: row;
			flex-wrap: wrap;
			gap: 8px;
			align-items: center;
		}

		.dag-connector {
			width: 18px;
			height: 1px;
			margin-left: 0;
		}

		.dag-connector--active {
			background: var(--primary);
		}

		.features-top {
			grid-template-columns: 1fr;
		}

		.feature-primary {
			padding: 36px 0;
			border-right: none;
			border-bottom: 1px solid var(--border);
		}

		.feature-aside-item {
			padding: 24px 0;
		}

		.features-power {
			grid-template-columns: repeat(2, 1fr);
		}

		.features-workflow {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 600px) {
		h1 {
			font-size: clamp(2.2rem, 9vw, 3rem);
		}

		.hero-sub {
			font-size: 16px;
		}

		.hero-preview {
			max-height: 380px;
			overflow: hidden;
		}

		.features-power,
		.features-workflow {
			grid-template-columns: 1fr;
		}

		.flow-visual {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.hero-content,
		.hero-preview {
			animation: none !important;
		}
	}
</style>
