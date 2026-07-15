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

// A fixed-size crop window (a constant ~16% push-in), centered on the focus point. Earlier
// this tried to size the crop to *cover* the padded focus rect, which silently degenerated
// to the full frame (no zoom at all) for any tall element — most notebook cells stack
// code+result+chart vertically and are taller than the 16:9 frame, so "cover this box while
// matching frame aspect" always demanded a crop bigger than the frame itself. A real Ken
// Burns push doesn't try to exactly frame an element — it's a small, consistent move toward
// a point of interest, regardless of how big or oddly-shaped that element's box is.
function computeCropWindow(focus, width, height) {
	if (!focus || focus.width <= 0 || focus.height <= 0) return null;
	const cw = width / ZOOM_FACTOR;
	const ch = height / ZOOM_FACTOR;
	const cx = focus.x + focus.width / 2 - cw / 2;
	const cy = focus.y + focus.height / 2 - ch / 2;
	const x = Math.max(0, Math.min(width - cw, cx));
	const y = Math.max(0, Math.min(height - ch, cy));
	return { x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch) };
}

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
// beats with a focus point) an animated crop that eases toward it and back out. 'quick'
// beats never zoom — they already layer real cursor motion + the app's own UI transitions,
// and holding the frame static there is real shot variety, not a missed opportunity.
function segmentFilter(index, seg, width, height) {
	const dur = seg.end - seg.start;
	const crop = computeCropWindow(seg.focus, width, height);
	const label = `s${index}`;
	const parts = [
		`trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)}`,
		'setpts=PTS-STARTPTS'
	];
	if (crop) {
		const ease = easeExpr('t', dur, EASE_SEC);
		const x = `(${crop.x})*(${ease})`;
		const y = `(${crop.y})*(${ease})`;
		const w = `${width}-(${width}-${crop.w})*(${ease})`;
		const h = `${height}-(${height}-${crop.h})*(${ease})`;
		// crop's x/y/w/h expressions are always evaluated per-frame when they reference
		// frame-dependent variables like `t` — there's no `eval` option on this filter
		// (that exists on drawtext/overlay, not crop); passing it is a hard error.
		parts.push(`crop=w='${w}':h='${h}':x='${x}':y='${y}'`);
		parts.push(`scale=${width}:${height}`);
	}
	// concat requires every input to agree on SAR, not just pixel dimensions — a segment
	// that skipped the crop+scale branch (no focus rect) otherwise carries through
	// whatever SAR the source stream happened to encode, which concat then rejects.
	parts.push('setsar=1');
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
	const concatInputs = segments.map((_, i) => `[s${i}]`).join('');
	// Playwright's recordVideo produces a variable, per-chapter frame rate (whatever it
	// actually painted) — xfade later requires every chapter input to share one constant
	// rate, so normalize it here rather than at the final stitch step.
	const filterComplex = `${chains.join(';')};${concatInputs}concat=n=${segments.length}:v=1:a=0,fps=${OUTPUT_FPS}[outv]`;
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
