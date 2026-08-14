/**
 * Text measurement and fitting.
 *
 * The card has to look right at 16:9 and at 9:16, with quotes anywhere from a
 * sentence to a long paragraph. Rather than fix a font size, we binary-search the
 * largest size whose wrapped text still fits the available box.
 */

export interface FittedText {
	size: number;
	lines: string[];
	lineHeight: number;
	/** Total height of the rendered block. */
	height: number;
}

/** Build a CSS font shorthand at a given size. */
export type FontSpec = (size: number) => string;

/**
 * Greedy word wrap. Paragraphs (separated by blank lines) are preserved as
 * separate runs of lines; an empty string marks the paragraph gap.
 */
export function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number
): string[] {
	const out: string[] = [];

	text.split(/\n{2,}/).forEach((paragraph, index) => {
		if (index > 0) out.push("");

		let line = "";
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			const candidate = line ? `${line} ${word}` : word;
			if (ctx.measureText(candidate).width <= maxWidth) {
				line = candidate;
				continue;
			}
			if (line) {
				out.push(line);
				line = "";
			}
			// A single word wider than the box (a long URL) must be broken by character,
			// otherwise the fit search would never converge.
			if (ctx.measureText(word).width > maxWidth) {
				let chunk = "";
				for (const char of word) {
					if (chunk && ctx.measureText(chunk + char).width > maxWidth) {
						out.push(chunk);
						chunk = char;
					} else {
						chunk += char;
					}
				}
				line = chunk;
			} else {
				line = word;
			}
		}
		if (line) out.push(line);
	});

	return out;
}

export interface FitOptions {
	font: FontSpec;
	lineHeightRatio: number;
	minSize: number;
	maxSize: number;
}

/** Largest font size at which `text` wraps into `box` without overflowing. */
export function fitTextToBox(
	ctx: CanvasRenderingContext2D,
	text: string,
	box: { w: number; h: number },
	opts: FitOptions
): FittedText {
	const measure = (size: number) => {
		ctx.font = opts.font(size);
		const lines = wrapText(ctx, text, box.w);
		const lineHeight = size * opts.lineHeightRatio;
		return { size, lines, lineHeight, height: lines.length * lineHeight };
	};

	let lo = opts.minSize;
	let hi = opts.maxSize;
	let best = measure(opts.minSize);

	// ~20 halvings is far past sub-pixel precision for any realistic range.
	for (let i = 0; i < 20 && hi - lo > 0.25; i++) {
		const mid = (lo + hi) / 2;
		const candidate = measure(mid);
		if (candidate.height <= box.h) {
			best = candidate;
			lo = mid;
		} else {
			hi = mid;
		}
	}

	return best;
}

/**
 * Fit a single unwrapped line (a title or byline) into `maxWidth`.
 *
 * Shrinks toward `minScale` first, since a slightly smaller title reads better than
 * a truncated one, and only ellipsizes when even the smallest size overflows.
 * Callers reserve space at the nominal size, so the result never grows.
 */
export function fitSingleLine(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	font: FontSpec,
	size: number,
	minScale = 0.72
): { text: string; size: number } {
	const fits = (candidate: string, at: number) => {
		ctx.font = font(at);
		return ctx.measureText(candidate).width <= maxWidth;
	};

	if (fits(text, size)) return { text, size };

	const floor = size * minScale;
	let lo = floor;
	let hi = size;
	let best = floor;
	for (let i = 0; i < 12 && hi - lo > 0.25; i++) {
		const mid = (lo + hi) / 2;
		if (fits(text, mid)) {
			best = mid;
			lo = mid;
		} else {
			hi = mid;
		}
	}
	if (fits(text, best)) return { text, size: best };

	// Still too wide at the smallest size: trim characters until the ellipsis fits.
	let trimmed = text;
	while (trimmed.length > 1 && !fits(`${trimmed.trimEnd()}…`, floor)) {
		trimmed = trimmed.slice(0, -1);
	}
	return { text: `${trimmed.trimEnd()}…`, size: floor };
}

/** Draw pre-fitted lines from a top-left origin. Returns the y after the last line. */
export function drawLines(
	ctx: CanvasRenderingContext2D,
	fitted: FittedText,
	x: number,
	y: number
): number {
	ctx.textBaseline = "top";
	let cursor = y;
	for (const line of fitted.lines) {
		// Empty entries are paragraph gaps — advance without painting.
		if (line) ctx.fillText(line, x, cursor);
		cursor += fitted.lineHeight;
	}
	return cursor;
}
