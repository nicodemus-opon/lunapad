#!/usr/bin/env node
// Single entrypoint for the Lunapad demo video: records one Playwright browser context
// per chapter against the real dev server, applies a camera push-in per beat, then
// crossfades the chapters together into one finished mp4.
//
//   node scripts/demo-video/record.mjs --mode=fast|full [--smoke] [--print-script]
//
// DEMO_VIDEO_RAW=1 switches to raw-capture mode for the Remotion trailer: overlay.mjs stops
// burning captions/keyflash/feature-cards into the DOM and instead logs them + flashes a
// frame-accurate corner marker (see overlay.mjs, detect-markers.mjs); this script skips the
// ffmpeg Ken-Burns/xfade steps entirely (Remotion owns that now) and instead writes one clean
// per-chapter mp4 + one beats.json (real detected frame numbers, not wall-clock estimates) per
// chapter. Every branch below is additive and gated on RAW so the default path is unchanged.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as actions from './actions.mjs';
import * as overlay from './overlay.mjs';
import { installFullWalkthroughMocks } from './mocks.mjs';
import { beatsFor, CHAPTERS, computeHoldMs } from './beats.mjs';
import { convertWebmToMp4, renderChapterWithZoom, xfadeChapters, contactSheet } from './zoom.mjs';
import { detectMarkerFrames, zipEventsWithFrames, probeFps } from './detect-markers.mjs';

const args = process.argv.slice(2);
const mode = args.includes('--mode=full') ? 'full' : 'fast';
const smoke = args.includes('--smoke');
const printScript = args.includes('--print-script');
const RAW = process.env.DEMO_VIDEO_RAW === '1';

const VIDEO = { width: 1920, height: 1080 };
const PORT = process.env.DEMO_VIDEO_PORT ?? (mode === 'full' ? '5898' : '5897');
const BASE = `http://localhost:${PORT}`;
const OUT = actions.ARTIFACTS_DIR;

if (printScript) {
	printBeatScript();
	process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
if (smoke) process.env.DEMO_VIDEO_SPEED = '0.15';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function printBeatScript() {
	for (const m of ['fast', 'full']) {
		console.log(`\n=== ${m} ===`);
		for (const chapter of CHAPTERS) {
			const list = beatsFor(m, chapter);
			if (!list.length) continue;
			console.log(`\n-- ${chapter} --`);
			for (const b of list) console.log(`  [${b.pace}] ${b.id}`);
		}
	}
}

// Wraps every module's exported functions so a beat can call a.thing(...args) /
// o.thing(...args) without threading `page` through every call site.
function bindPage(mod, page) {
	const bound = {};
	for (const [name, val] of Object.entries(mod)) {
		bound[name] = typeof val === 'function' ? (...callArgs) => val(page, ...callArgs) : val;
	}
	return bound;
}

async function waitForServer(proc) {
	const started = Date.now();
	while (Date.now() - started < 120_000) {
		if (proc.exitCode !== null) throw new Error(`dev server exited with ${proc.exitCode}`);
		try {
			const res = await fetch(BASE);
			if (res.status < 500) return;
		} catch {
			// keep waiting for the server to come up
		}
		await sleep(500);
	}
	throw new Error('Timed out waiting for dev server');
}

function spawnServer() {
	const server = spawn('pnpm', ['exec', 'vite', 'dev', '--host', 'localhost', '--port', PORT], {
		// DEMO_MODE (server-wide) would force *every* request — including the intro
		// chapter's intentionally blank `/` load — straight into the bootstrapped demo
		// notebook, defeating the template-gallery beat. `loadDemoDirect`'s `?demo=1` query
		// param achieves the same bootstrap per-chapter instead, so it's not needed here.
		env: { ...process.env, DISABLE_AUTH: '1' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	server.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
	server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
	return server;
}

// Fails loudly, fast — navigates once and checks every UI-chrome selector the enabled
// beats will use actually resolves, instead of discovering a broken one 8 minutes into a
// recording. Deliberately does NOT bootstrap the real demo notebook here: doing a full
// DuckDB-WASM demo-data bootstrap in a throwaway context and then doing it *again* in the
// first real recorded chapter reliably made the second bootstrap hang (observed
// repeatedly in this environment) — cell-name/demo-data correctness is instead verified
// by the beats themselves, which already fail loudly with a clear message on the first
// real run-all beat if something's wrong.
async function assertSelectors(browser) {
	const problems = [];
	const context = await browser.newContext({ viewport: VIDEO, baseURL: BASE });
	const page = await context.newPage();
	try {
		await actions.loadFresh(page);
		await check('File menu', () => page.getByRole('button', { name: 'File', exact: true }));
		await page.getByRole('button', { name: 'File', exact: true }).click();
		await check('Browse templates menu item', () =>
			page.getByRole('menuitem', { name: /Browse templates/ })
		);
		await page.keyboard.press('Escape');

		if (mode === 'full') {
			// A blank notebook tab is enough to mount the header's notebook-scoped
			// buttons (AI, review inbox) — no need for the real demo data bootstrap.
			await page.getByRole('button', { name: 'File', exact: true }).click();
			await page.getByRole('menuitem', { name: /New notebook/ }).click();
			await check('AI toggle', () => page.getByTestId('ai-toggle'));
			await page.getByTestId('ai-toggle').click();
			await check('AI input', () => page.getByTestId('ai-input'));
			await check('AI send', () => page.getByTestId('ai-send'));
			await page.keyboard.press('Escape');
			await check('"Open review inbox" button', () =>
				page.getByRole('button', { name: 'Open review inbox' })
			);
			await check('Upload file button', () => page.getByRole('button', { name: 'Upload file' }));
			await check('View menu', () => page.getByRole('button', { name: 'View', exact: true }));
		}
	} catch (err) {
		problems.push(`unexpected pre-flight failure: ${err.message}`);
	} finally {
		await context.close();
	}

	async function check(label, locatorFn) {
		try {
			const count = await locatorFn().count();
			if (count < 1) problems.push(`missing: ${label}`);
		} catch (err) {
			problems.push(`error checking ${label}: ${err.message}`);
		}
	}

	if (problems.length) {
		throw new Error(`Pre-flight selector check failed:\n  - ${problems.join('\n  - ')}`);
	}
	console.log('Pre-flight selector check passed.');
}

async function step(label, fn, { optional = false } = {}) {
	const started = Date.now();
	try {
		const result = await fn();
		console.log(`  ok   ${label} (${Date.now() - started}ms)`);
		return result;
	} catch (err) {
		if (optional) {
			console.warn(`  [SKIPPED-OPTIONAL] ${label}: ${err.message}`);
			return null;
		}
		throw new Error(`beat "${label}" failed: ${err.message}`);
	}
}

// Only records — no ffmpeg here. Keeping every CPU-heavy encode out of the browser-driving
// phase avoids sandwiching a libx264 encode between two Chromium/DuckDB-WASM launches;
// under load in this environment that ordering was enough to make the *next* chapter's
// demo-notebook bootstrap hang unpredictably (sometimes instantly, sometimes for minutes).
// All ffmpeg work now happens in one batch after every chapter has finished recording.
async function recordChapter(browser, chapterName, beatList) {
	console.log(`\n--- chapter: ${chapterName} (${beatList.length} beats) ---`);
	const context = await browser.newContext({
		viewport: VIDEO,
		baseURL: BASE,
		recordVideo: { dir: OUT, size: VIDEO }
	});
	const page = await context.newPage();
	page.on('pageerror', (err) => console.log(`  [${chapterName} pageerror]`, err.message));
	await overlay.installOverlay(page, { raw: RAW });
	const t0 = Date.now();

	if (chapterName === 'power') await installFullWalkthroughMocks(page);

	if (chapterName === 'intro') {
		await actions.loadFresh(page);
	} else {
		await actions.loadDemoDirect(page);
	}
	const loadingTrimSec = Math.max(0, (Date.now() - t0) / 1000 - 0.3);

	// Keep the sidebar off-screen for the whole recording — the shared dev workspace
	// behind it accumulates stray notebooks/folders across every local test run (a single
	// Postgres-backed row, not per-session), and the cheapest, most robust fix is simply to
	// never show it on camera rather than reaching into that shared store. `intro` is the
	// one exception: its own `sidebar-flourish` beat does this collapse on camera as a
	// deliberate flourish, so a second silent press here would just toggle it back open.
	if (chapterName !== 'intro') await actions.collapseSidebar(page);
	// The notebook tab strip isn't part of any beat's narrative — always hide it, every
	// chapter including intro, purely to keep the accumulated stray-tab clutter off camera.
	await actions.hideNotebookTabs(page);

	const a = bindPage(actions, page);
	const o = bindPage(overlay, page);
	await o.park();

	const segments = [];
	let cursor = 0;
	const beatClockStart = Date.now();
	for (const beat of beatList) {
		const holdMs = computeHoldMs(beat);
		const rawFocus = await step(`${chapterName}/${beat.id}`, () => beat.run({ page, a, o, holdMs }), {
			optional: beat.optional
		});
		// 'quick' beats never get a camera push — they already layer real cursor motion
		// plus the app's own UI transition, and holding the frame static there is
		// deliberate shot variety, not a missed zoom.
		const focus = beat.pace === 'quick' ? null : rawFocus;
		if (RAW) {
			// No wall-clock timing here at all — see this file's top comment and
			// detect-markers.mjs for why. `log` is this beat's slice of caption/keyflash/
			// featureCard/focus events, in order; frame numbers get attached in encodeChapter
			// once the chapter's video (and its corner-marker flashes) actually exists.
			const log = await overlay.drainLog(page);
			segments.push({ id: beat.id, captions: beat.captions ?? [], focus: focus ?? null, log });
		} else {
			const end = (Date.now() - beatClockStart) / 1000;
			segments.push({ start: cursor, end, focus: focus ?? null });
			cursor = end;
		}
	}

	const video = page.video();
	await page.close();
	await context.close();
	if (!video) throw new Error(`No video produced for chapter ${chapterName}`);

	const webm = path.join(OUT, `${mode}-${chapterName}.webm`);
	await video.saveAs(webm);
	return { chapterName, webm, segments, loadingTrimSec };
}

async function encodeChapter({ chapterName, webm, segments, loadingTrimSec }) {
	if (RAW) {
		const cleanMp4 = path.join(OUT, `${mode}-${chapterName}.clean.mp4`);
		await convertWebmToMp4(webm, cleanMp4, loadingTrimSec);

		// Detection runs once on the whole chapter's video; the flat, ordered list of detected
		// frames gets zipped against the flat, ordered concatenation of every beat's log (both
		// orderings come from the same beat-list run), then re-sliced back into per-beat groups.
		const flatLog = segments.flatMap((s) => s.log);
		const fps = await probeFps(cleanMp4);
		const frames = await detectMarkerFrames(cleanMp4);
		const zipped = zipEventsWithFrames(flatLog, frames);
		let cursor = 0;
		const beats = segments.map((s) => {
			const events = zipped.slice(cursor, cursor + s.log.length);
			cursor += s.log.length;
			return { id: s.id, captions: s.captions, focus: s.focus, events };
		});

		const beatsJsonPath = path.join(OUT, `${mode}-${chapterName}.beats.json`);
		fs.writeFileSync(
			beatsJsonPath,
			JSON.stringify(
				{ chapterName, video: path.basename(cleanMp4), width: VIDEO.width, height: VIDEO.height, fps, beats },
				null,
				2
			)
		);
		console.log(`  wrote ${beatsJsonPath}`);
		return cleanMp4;
	}

	const rawMp4 = path.join(OUT, `${mode}-${chapterName}.raw.mp4`);
	const finalMp4 = path.join(OUT, `${mode}-${chapterName}.mp4`);
	await convertWebmToMp4(webm, rawMp4, loadingTrimSec);
	if (smoke) {
		fs.copyFileSync(rawMp4, finalMp4);
	} else {
		await renderChapterWithZoom(rawMp4, finalMp4, segments, VIDEO);
	}
	return finalMp4;
}

async function main() {
	const server = spawnServer();
	try {
		await waitForServer(server);

		// Each chapter gets its own Chromium *process* (not just a new context in a shared
		// one) — a second DuckDB-WASM demo-notebook bootstrap in a later context of the
		// same browser process was observed to hang unpredictably (sometimes instantly,
		// sometimes 100+ seconds, sometimes indefinitely) in this environment, most likely
		// leftover worker/wasm-linear-memory state from the previous context's DuckDB
		// instance. A fresh process per chapter costs a couple seconds of extra launch
		// time but removes that failure mode entirely.
		{
			const preflightBrowser = await chromium.launch();
			try {
				await assertSelectors(preflightBrowser);
			} finally {
				await preflightBrowser.close();
			}
		}

		const onlyChapter = process.env.DEMO_VIDEO_CHAPTER;
		let chapterNames = smoke ? ['intro', 'core'] : CHAPTERS.filter((c) => c !== 'power' || mode === 'full');
		if (onlyChapter) chapterNames = chapterNames.filter((c) => c === onlyChapter);
		const recordings = [];
		for (const chapterName of chapterNames) {
			let list = beatsFor(mode, chapterName);
			if (smoke && chapterName === 'core') list = list.slice(0, 2);
			if (!list.length) continue;
			const chapterBrowser = await chromium.launch();
			try {
				recordings.push(await recordChapter(chapterBrowser, chapterName, list));
			} finally {
				await chapterBrowser.close();
			}
		}

		// All browser/DuckDB work is done — encode every chapter now, in one batch.
		const chapterPaths = [];
		for (const recording of recordings) {
			chapterPaths.push(await encodeChapter(recording));
		}

		if (RAW) {
			// Remotion owns chapter-to-chapter assembly now — no combined mp4 from this pipeline.
			console.log(`\nWrote ${chapterPaths.length} raw chapters:`);
			for (const p of chapterPaths) console.log(`  ${p}`);
			return;
		}

		const outName = mode === 'full' ? 'full-walkthrough.mp4' : 'fast-demo.mp4';
		const finalPath = path.join(OUT, smoke ? `smoke-${outName}` : outName);
		if (smoke) {
			await concatPlain(chapterPaths, finalPath);
		} else {
			await xfadeChapters(chapterPaths, finalPath, VIDEO);
		}
		console.log(`\nWrote ${finalPath}`);

		const sheetPath = finalPath.replace(/\.mp4$/, '.contact-sheet.png');
		await contactSheet(finalPath, sheetPath).catch((err) =>
			console.warn(`contact sheet failed (non-fatal): ${err.message}`)
		);
		console.log(`Wrote ${sheetPath}`);
	} finally {
		server.kill('SIGTERM');
	}
}

async function concatPlain(paths, outputPath) {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const exec = promisify(execFile);
	const listPath = `${outputPath}.concat.txt`;
	fs.writeFileSync(listPath, paths.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join('\n'));
	await exec('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]);
	fs.rmSync(listPath);
}

await main();
