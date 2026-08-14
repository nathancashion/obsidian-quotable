/**
 * Text measurement, fitting, and inline emphasis.
 *
 * The card has to look right at 16:9 and at 9:16, with quotes anywhere from a
 * sentence to a long paragraph, so font size is binary-searched rather than fixed.
 *
 * Emphasis is handled here rather than at capture time: the quote stays a plain
 * markdown string all the way through (so it remains editable in the modal) and is
 * parsed into styled runs only when drawn. Canvas has no rich text, so a styled
 * line is a list of runs, each painted with its own font.
 */

/** A span of text sharing one style. */
export interface Run {
	text: string;
	bold: boolean;
	italic: boolean;
}

/** Build a CSS font shorthand at a given size. */
export type FontSpec = (size: number) => string;

/** Build a CSS font shorthand for a given size and emphasis combination. */
export type StyledFontSpec = (size: number, bold: boolean, italic: boolean) => string;

/** A wrapped line is a list of runs. An empty line marks a paragraph gap. */
export type StyledLine = Run[];

export interface FittedText {
	size: number;
	lines: StyledLine[];
	lineHeight: number;
	/** Total height of the rendered block. */
	height: number;
}

// --- emphasis parsing ---

const isSpace = (char: string | undefined) => !char || /\s/.test(char);

/**
 * Parse `**bold**`, `*italic*` and `***both***` into runs.
 *
 * Delimiters must "flank" the text they emphasise — an opener needs a non-space
 * after it, a closer a non-space before it — which is what keeps a lone asterisk
 * in prose (or arithmetic like `2 * 3`) from silently italicising the remainder.
 * Underscores are deliberately not treated as emphasis, since that would mangle
 * snake_case identifiers.
 */
export function parseEmphasis(text: string): Run[] {
	const runs: Run[] = [];
	let bold = false;
	let italic = false;
	let buffer = "";
	let i = 0;

	const flush = () => {
		if (buffer) runs.push({ text: buffer, bold, italic });
		buffer = "";
	};

	while (i < text.length) {
		const triple = text.startsWith("***", i);
		const double = !triple && text.startsWith("**", i);
		const single = !triple && !double && text[i] === "*";

		if (triple || double || single) {
			const width = triple ? 3 : double ? 2 : 1;
			const open = triple ? !bold && !italic : double ? !bold : !italic;
			const after = text[i + width];
			const before = text[i - 1];
			// An opener needs following text; a closer needs preceding text.
			const valid = open ? !isSpace(after) : !isSpace(before);

			if (valid) {
				flush();
				if (triple) {
					bold = !bold;
					italic = !italic;
				} else if (double) {
					bold = !bold;
				} else {
					italic = !italic;
				}
				i += width;
				continue;
			}
		}

		buffer += text[i];
		i += 1;
	}

	flush();
	return runs;
}

// --- wrapping ---

interface Token extends Run {
	whitespace: boolean;
}

function tokenize(runs: Run[]): Token[] {
	const tokens: Token[] = [];
	for (const run of runs) {
		for (const part of run.text.split(/(\s+)/)) {
			if (!part) continue;
			tokens.push({
				text: part,
				bold: run.bold,
				italic: run.italic,
				whitespace: /^\s+$/.test(part),
			});
		}
	}
	return tokens;
}

/** Collapse adjacent same-style tokens so each line needs fewer fillText calls. */
function mergeTokens(tokens: Token[]): StyledLine {
	const runs: StyledLine = [];
	for (const token of tokens) {
		const last = runs[runs.length - 1];
		if (last && last.bold === token.bold && last.italic === token.italic) {
			last.text += token.text;
		} else {
			runs.push({ text: token.text, bold: token.bold, italic: token.italic });
		}
	}
	return runs;
}

function tokenWidth(
	ctx: CanvasRenderingContext2D,
	token: Run,
	size: number,
	font: StyledFontSpec
): number {
	ctx.font = font(size, token.bold, token.italic);
	return ctx.measureText(token.text).width;
}

/** Greedy word wrap over styled runs. */
export function wrapStyled(
	ctx: CanvasRenderingContext2D,
	runs: Run[],
	maxWidth: number,
	size: number,
	font: StyledFontSpec
): StyledLine[] {
	const lines: StyledLine[] = [];
	let current: Token[] = [];
	let width = 0;

	const flush = () => {
		while (current.length && current[current.length - 1].whitespace) current.pop();
		if (current.length) lines.push(mergeTokens(current));
		current = [];
		width = 0;
	};

	for (const token of tokenize(runs)) {
		// Never start a line with a space.
		if (token.whitespace && current.length === 0) continue;

		const w = tokenWidth(ctx, token, size, font);

		// A single token wider than the box (a long URL) must be split by character,
		// or the fit search would never converge.
		if (!token.whitespace && w > maxWidth) {
			flush();
			let chunk = "";
			for (const char of token.text) {
				const candidate = chunk + char;
				if (chunk && tokenWidth(ctx, { ...token, text: candidate }, size, font) > maxWidth) {
					lines.push([{ text: chunk, bold: token.bold, italic: token.italic }]);
					chunk = char;
				} else {
					chunk = candidate;
				}
			}
			if (chunk) {
				current.push({ ...token, text: chunk });
				width = tokenWidth(ctx, { ...token, text: chunk }, size, font);
			}
			continue;
		}

		if (!token.whitespace && current.length && width + w > maxWidth) flush();

		current.push(token);
		width += w;
	}

	flush();
	return lines;
}

export interface FitOptions {
	font: StyledFontSpec;
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
	// Paragraphs are parsed separately so a blank line survives as a real gap.
	const paragraphs = text.split(/\n{2,}/).map((p) => parseEmphasis(p));

	const measure = (size: number): FittedText => {
		const lines: StyledLine[] = [];
		paragraphs.forEach((runs, index) => {
			if (index > 0) lines.push([]);
			lines.push(...wrapStyled(ctx, runs, box.w, size, opts.font));
		});
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

/** Greedy word wrap for unstyled text at the context's current font. */
function wrapPlain(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const candidate = line ? `${line} ${word}` : word;
		if (!line || ctx.measureText(candidate).width <= maxWidth) {
			line = candidate;
		} else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

/**
 * Fit text into at most `maxLines`, preferring to wrap rather than shrink.
 *
 * Used for the title, where forcing a long book title onto one line shrinks it to
 * the point of illegibility. Wrapping first keeps it at full size; only if it still
 * doesn't fit does the size come down, and only then is it truncated.
 */
export function fitWrappedLines(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	font: FontSpec,
	size: number,
	maxLines: number,
	minScale = 0.8
): { lines: string[]; size: number } {
	const wrapAt = (at: number) => {
		ctx.font = font(at);
		return wrapPlain(ctx, text, maxWidth);
	};

	const atFullSize = wrapAt(size);
	if (atFullSize.length <= maxLines) return { lines: atFullSize, size };

	const floor = size * minScale;
	let lo = floor;
	let hi = size;
	let best = wrapAt(floor);
	let bestSize = floor;
	for (let i = 0; i < 12 && hi - lo > 0.25; i++) {
		const mid = (lo + hi) / 2;
		const lines = wrapAt(mid);
		if (lines.length <= maxLines) {
			best = lines;
			bestSize = mid;
			lo = mid;
		} else {
			hi = mid;
		}
	}

	if (best.length <= maxLines) return { lines: best, size: bestSize };

	// Still too long at the smallest size: keep the first lines and ellipsize.
	ctx.font = font(floor);
	const kept = best.slice(0, maxLines);
	let last = kept[maxLines - 1] ?? "";
	while (last.length > 1 && ctx.measureText(`${last.trimEnd()}…`).width > maxWidth) {
		last = last.slice(0, -1);
	}
	kept[maxLines - 1] = `${last.trimEnd()}…`;
	return { lines: kept, size: floor };
}

/**
 * Draw pre-fitted styled lines from a top-left origin. Returns the y after the last
 * line. Each run is painted separately and the cursor advanced by its measured
 * width, so kerning across a style boundary is lost — imperceptible at these sizes.
 */
export function drawStyledLines(
	ctx: CanvasRenderingContext2D,
	fitted: FittedText,
	x: number,
	y: number,
	font: StyledFontSpec
): number {
	ctx.textBaseline = "top";
	let cursorY = y;
	for (const line of fitted.lines) {
		let cursorX = x;
		for (const run of line) {
			ctx.font = font(fitted.size, run.bold, run.italic);
			ctx.fillText(run.text, cursorX, cursorY);
			cursorX += ctx.measureText(run.text).width;
		}
		cursorY += fitted.lineHeight;
	}
	return cursorY;
}
