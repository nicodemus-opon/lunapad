// Turns a chapter's flat recording into something with a directed camera: each beat that
// reported a focus rect (see beats.mjs) gets a push-in toward that element and an ease
// back out, instead of a locked-off static frame for the whole chapter. This runs on the
// *real* captured footage (crop+scale over the actual recorded frames), not a fake zoom
// applied to a still — so motion inside the crop (cursor, scrolling, chart re-render)
// stays real.
//
// Simplification vs. recording at a larger-than-output virtual viewport: we record at the
// final output resolution and crop+scale back up within it. At 1080p the quality loss from
// scaling a ~70%-area crop back up is not visible in a compressed marketing video, and it
// avoids a second resize pass on every chapter.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const EASE_SEC = 0.7; // time to push in / ease back out at each end of a beat's hold
const ZOOM_FACTOR = 1.16; // subtle, fixed push — never tries to "fit" an arbitrary UI element
const BEAT_XFADE_SEC = 0.35; // crossfade between beats within a chapter (shorter than the
// 0.6s chapter-to-chapter one — these are more frequent and each beat's hold is tighter)

// Piecewise-linear ramp (ease in from 0, hold at 1, ease out back to 0), then composed with
// a cubic smoothstep so there's no velocity-discontinuity corner where the ramp meets the
// hold: smoothstep has zero derivative at both 0 and 1, which (by the chain rule) cancels
// the incoming ramp's constant velocity at that exact instant regardless of that velocity —
// true ease-in / hold / ease-out, no linear motion anywhere (motion-design: never linear
// for spatial movement).
function easeExpr(t, dur, ease) {
	const e = Math.min(ease, dur * 0.28); // cap so ease can never eat the whole segment —
	// ≤56% total in ease, ≥44% genuine hold, regardless of segment length
	if (e <= 0.01) return '1';
	const L = `min(min((${t})/${e.toFixed(3)},1),min((${dur.toFixed(3)}-(${t}))/${e.toFixed(3)},1))`;
	return `(3*(${L})*(${L})-2*(${L})*(${L})*(${L}))`; // cubic smoothstep: 3L²-2L³
}

// Builds the filter_complex for one segment: trim, reset timestamps, then (for non-'quick'
// beats with a focus point) an animated push toward it and back out. 'quick' beats never
// zoom — they already layer real cursor motion + the app's own UI transitions, and holding
// the frame static there is real shot variety, not a missed opportunity.
//
// Scale-then-crop, not crop-then-scale: the earlier version animated `crop`'s own w/h (the
// crop rectangle's pixel size shrank toward the target, then got rescaled back up to a
// constant output size) — two stages with time-varying dimensions, and every frame during
// the ease got resampled from a different pre-scale size than its neighbor, a known source
// of shimmer in hand-rolled ffmpeg zoom pipelines. Here `scale` (whose whole job is smoothly
// resizing a frame) carries the *only* time-varying dimension — it grows the whole frame by
// a zoom factor Z(t) — and `crop` afterward always cuts out a **constant** width×height
// window, just at a moving position, which is a plain pan, not a resize.
function segmentFilter(index, seg, width, height) {
	const dur = seg.end - seg.start;
	const label = `s${index}`;
	const parts = [
		`trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)}`,
		'setpts=PTS-STARTPTS'
	];
	const focus = seg.focus;
	if (focus && focus.width > 0 && focus.height > 0) {
		const ease = easeExpr('t', dur, EASE_SEC);
		// Z(t): 1.0 (no zoom) at rest, ZOOM_FACTOR at the peak of the ease.
		const z = `(1+${(ZOOM_FACTOR - 1).toFixed(4)}*(${ease}))`;
		// Even-round the scaled frame size (yuv420p needs even dimensions) — the crop clamp
		// below reuses these exact (rounded) expressions so its bounds match what `scale`
		// actually produced, not the pre-rounding value.
		const scaledW = `trunc((${width}*${z})/2)*2`;
		const scaledH = `trunc((${height}*${z})/2)*2`;
		const fcx = focus.x + focus.width / 2;
		const fcy = focus.y + focus.height / 2;
		// Where the focus point ends up in the enlarged frame, centered in a width×height
		// window, clamped so the window never runs past the enlarged frame's edge.
		const x = `max(0,min((${scaledW})-${width},(${fcx})*(${z})-${width}/2))`;
		const y = `max(0,min((${scaledH})-${height},(${fcy})*(${z})-${height}/2))`;
		// Unlike crop, scale defaults to evaluating w/h expressions once at init — `t` is
		// only valid per-frame with an explicit eval=frame.
		parts.push(`scale=w='${scaledW}':h='${scaledH}':eval=frame`);
		parts.push(`crop=w=${width}:h=${height}:x='${x}':y='${y}'`);
	}
	// xfade/concat require every input to agree on SAR, not just pixel dimensions — a
	// segment that skipped the scale+crop branch (no focus rect) otherwise carries through
	// whatever SAR the source stream happened to encode, which the stitch step then rejects.
	parts.push('setsar=1');
	// xfade also *requires* a constant frame rate on every input it's given — Playwright's
	// recordVideo produces a variable rate (whatever it actually painted), and a `trim` of
	// that alone still reports as variable/undefined ("1/0"). Normalize per-segment, not
	// only once at the very end, or xfade refuses to configure at all.
	parts.push(`fps=${OUTPUT_FPS}`);
	return `[0:v]${parts.join(',')}[${label}]`;
}

// segments: [{ start, end, focus }] in seconds, contiguous, covering the whole
// chapter (segment[0].start === 0). Produces one mp4 with per-beat camera moves baked in.
const OUTPUT_FPS = 30;

export async function renderChapterWithZoom(inputPath, outputPath, segments, { width, height }) {
	if (!segments.length) {
		await exec('ffmpeg', [
			'-y',
			'-i',
			inputPath,
			'-r',
			String(OUTPUT_FPS),
			'-c:v',
			'libx264',
			'-preset',
			'fast',
			'-crf',
			'20',
			'-pix_fmt',
			'yuv420p',
			outputPath
		]);
		return;
	}
	const chains = segments.map((seg, i) => segmentFilter(i, seg, width, height));
	// Crossfade every beat into the next instead of a hard concat — a chapter with 5-9
	// beats otherwise has 4-8 instant, unblended cuts, which reads as choppy regardless of
	// how good any individual shot is. Same pairwise-xfade-with-running-offset technique
	// xfadeChapters already uses for chapter boundaries, just applied one level down: each
	// `[sN]` here is already an independent labeled stream (from trimming the same source),
	// which is all xfade needs — it doesn't care that they share an origin file.
	const stitchParts = [];
	let prevLabel = 's0';
	let runningOffset = 0;
	for (let i = 1; i < segments.length; i++) {
		const prevDur = segments[i - 1].end - segments[i - 1].start;
		const curDur = segments[i].end - segments[i].start;
		// Never let the crossfade eat more than 40% of either adjacent beat's hold —
		// guards against a pathologically short beat swallowing itself.
		const xfadeDur = Math.max(0.05, Math.min(BEAT_XFADE_SEC, prevDur * 0.4, curDur * 0.4));
		runningOffset += prevDur - xfadeDur;
		// Last xfade in the chain writes directly to [outv]; each segment already carries a
		// constant fps (added in segmentFilter, since xfade requires it on every input), so
		// no separate normalization pass is needed here.
		const outLabel = i === segments.length - 1 ? 'outv' : `x${i}`;
		stitchParts.push(
			`[${prevLabel}][s${i}]xfade=transition=fade:duration=${xfadeDur.toFixed(3)}:offset=${runningOffset.toFixed(3)}[${outLabel}]`
		);
		prevLabel = outLabel;
	}
	const filterComplex =
		segments.length === 1
			? `${chains[0]};[s0]copy[outv]`
			: `${chains.join(';')};${stitchParts.join(';')}`;
	await exec('ffmpeg', [
		'-y',
		'-i',
		inputPath,
		'-filter_complex',
		filterComplex,
		'-map',
		'[outv]',
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-crf',
		'20',
		'-pix_fmt',
		'yuv420p',
		outputPath
	]);
}

// Crossfades an ordered list of chapter mp4s into one final video. Real cuts between
// sections (via a short crossfade) instead of a hard concat is what makes chapter
// boundaries read as edited transitions rather than one unbroken take.
export async function xfadeChapters(chapterPaths, outputPath, { width, height, fps = 30, duration: xfadeDur = 0.6 }) {
	if (chapterPaths.length === 1) {
		await exec('ffmpeg', ['-y', '-i', chapterPaths[0], '-c', 'copy', outputPath]);
		return;
	}
	const durations = await Promise.all(chapterPaths.map(probeDuration));
	const inputs = chapterPaths.flatMap((p) => ['-i', p]);
	let filter = '';
	let prevLabel = '0:v';
	let runningOffset = 0;
	for (let i = 1; i < chapterPaths.length; i++) {
		const outLabel = i === chapterPaths.length - 1 ? 'outv' : `x${i}`;
		runningOffset += durations[i - 1] - xfadeDur;
		filter += `[${prevLabel}][${i}:v]xfade=transition=fade:duration=${xfadeDur}:offset=${runningOffset.toFixed(3)}[${outLabel}];`;
		prevLabel = outLabel;
	}
	filter = filter.slice(0, -1);
	await exec('ffmpeg', [
		'-y',
		...inputs,
		'-filter_complex',
		filter,
		'-map',
		'[outv]',
		'-r',
		String(fps),
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-crf',
		'19',
		'-pix_fmt',
		'yuv420p',
		outputPath
	]);
}

export async function probeDuration(path) {
	const { stdout } = await exec('ffprobe', [
		'-v',
		'error',
		'-show_entries',
		'format=duration',
		'-of',
		'default=noprint_wrappers=1:nokey=1',
		path
	]);
	return parseFloat(stdout.trim());
}

export async function convertWebmToMp4(webmPath, mp4Path, startOffset = 0) {
	const args = ['-y'];
	if (startOffset > 0.1) args.push('-ss', startOffset.toFixed(2));
	args.push(
		'-i',
		webmPath,
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-crf',
		'20',
		'-pix_fmt',
		'yuv420p',
		mp4Path
	);
	await exec('ffmpeg', args);
}

// Extracts a handful of evenly spaced frames into one contact-sheet PNG, so a full render
// can be sanity-checked (cursor overlay present, captions legible, cuts visible) without
// watching the whole video.
export async function contactSheet(inputPath, outputPath, { tiles = 12, cols = 4 } = {}) {
	const dur = await probeDuration(inputPath);
	const every = Math.max(dur / tiles, 0.5);
	const rows = Math.ceil(tiles / cols);
	await exec('ffmpeg', [
		'-y',
		'-i',
		inputPath,
		'-vf',
		`fps=1/${every.toFixed(3)},scale=480:-1,tile=${cols}x${rows}`,
		'-frames:v',
		'1',
		outputPath
	]);
}
