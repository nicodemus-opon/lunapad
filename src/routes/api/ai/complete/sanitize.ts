/** Strip artifacts small models add despite instructions: fenced code blocks, thinking
 *  tags, a leading explanatory line, and overlap with prefix/suffix context. */
export function sanitizeCompletion(raw: string, prefix: string, suffix = ''): string {
	let text = raw.trim();

	// Reasoning models may emit chain-of-thought in content rather than a separate field.
	const thinkBlock = new RegExp('<' + 'think>[\\s\\S]*?</' + 'think>', 'gi');
	text = text
		.replace(thinkBlock, '')
		.replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
		.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
		.replace(/^\.{2,}\s*/, '')
		.trim();

	const fenced = text.match(/```[a-zA-Z]*\n?([\s\S]*?)```/);
	if (fenced) text = fenced[1].trim();

	const lines = text.split('\n');
	if (lines.length > 1 && /^(here|sure|completion|continuing)\b.*:$/i.test(lines[0].trim())) {
		text = lines.slice(1).join('\n').trim();
	}

	const prefixTail = prefix.slice(-40);
	for (let overlap = Math.min(prefixTail.length, text.length); overlap > 3; overlap--) {
		if (prefixTail.endsWith(text.slice(0, overlap))) {
			text = text.slice(overlap);
			break;
		}
	}

	const suffixHead = suffix.slice(0, 40);
	for (let overlap = Math.min(suffixHead.length, text.length); overlap > 3; overlap--) {
		if (text.endsWith(suffixHead.slice(0, overlap))) {
			text = text.slice(0, -overlap);
			break;
		}
	}

	const cappedLines = text.split('\n').slice(0, 8).join('\n');
	let capped = cappedLines.slice(0, 500).trim();

	// Models sometimes echo the prefix instead of continuing at the cursor — discard that.
	const normPrefix = prefix.trim().toLowerCase();
	const normCapped = capped.toLowerCase();
	if (
		normCapped.length > 12 &&
		(normPrefix.includes(normCapped) ||
			(normCapped.length > normPrefix.length * 0.5 && normPrefix.includes(normCapped.slice(0, 40))))
	) {
		const anchors = [80, 50, 30]
			.map((n) => prefix.trim().slice(-Math.min(n, prefix.trim().length)))
			.filter((a) => a.length >= 12);
		let salvaged = '';
		for (const anchor of anchors) {
			const anchorIdx = text.toLowerCase().lastIndexOf(anchor.toLowerCase());
			if (anchorIdx < 0) continue;
			salvaged = text
				.slice(anchorIdx + anchor.length)
				.replace(/^[\s.,;:]+/, '')
				.split('\n')
				.slice(0, 8)
				.join('\n')
				.slice(0, 500)
				.trim();
			if (salvaged.length > 0) break;
		}
		capped = salvaged;
	}

	return capped.length > 0 ? capped : '';
}
