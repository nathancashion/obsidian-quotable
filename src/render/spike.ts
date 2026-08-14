/**
 * Phase 0 spike.
 *
 * Draws a hardcoded card exercising every canvas feature the real renderer will need:
 * linear gradient, diagonal clip seam, a rotated image bleeding off the edge, an accent
 * bar, and auto-fitted wrapped text. If this looks right on both desktop and iOS, the
 * Canvas-2D architecture is sound and Phase 2 is mostly layout work.
 *
 * Superseded by src/render/canvas.ts in Phase 2.
 */

const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`;
const SANS = `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

const SAMPLE_QUOTE =
	"Light, intermittent activities such as taking short breaks from sitting and perhaps even " +
	"the muscular effort it takes to squat or kneel reduce levels of fat and sugar in your blood " +
	"more than if you sit inertly and passively for long.";

/** Greedy word wrap at a given font size. Returns the lines it produced. */
function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number
): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			const candidate = line ? `${line} ${word}` : word;
			if (ctx.measureText(candidate).width <= maxWidth || !line) {
				line = candidate;
			} else {
				lines.push(line);
				line = word;
			}
		}
		lines.push(line);
	}
	return lines;
}

/**
 * Binary-search the largest font size whose wrapped text fits the box.
 * This is what lets one quote look right at both 16:9 and 9:16.
 */
function fitText(
	ctx: CanvasRenderingContext2D,
	text: string,
	box: { w: number; h: number },
	lineHeightRatio: number,
	bounds: { min: number; max: number }
): { size: number; lines: string[]; lineHeight: number } {
	let lo = bounds.min;
	let hi = bounds.max;
	let best = { size: bounds.min, lines: [] as string[], lineHeight: bounds.min * lineHeightRatio };

	for (let i = 0; i < 24 && hi - lo > 0.5; i++) {
		const mid = (lo + hi) / 2;
		ctx.font = `400 ${mid}px ${SERIF}`;
		const lines = wrapText(ctx, text, box.w);
		const lineHeight = mid * lineHeightRatio;
		if (lines.length * lineHeight <= box.h) {
			best = { size: mid, lines, lineHeight };
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return best;
}

export interface SpikeOptions {
	width: number;
	height: number;
	cover?: HTMLImageElement | null;
}

export function renderSpikeCard(canvas: HTMLCanvasElement, opts: SpikeOptions): void {
	const { width: W, height: H, cover } = opts;
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d context unavailable");

	const unit = Math.min(W, H) / 100; // scale-independent spacing unit
	const stacked = H > W * 1.1; // 4:5 and 9:16 stack; 16:9 and 1:1 sit side by side

	// --- backdrop (visible wherever the cover doesn't reach) ---
	ctx.fillStyle = "#f4f2ec";
	ctx.fillRect(0, 0, W, H);

	// --- cover art, rotated and bleeding off the edge ---
	// Drawn first, then the text panel is clipped over it along a diagonal seam.
	if (cover) {
		ctx.save();
		if (stacked) {
			const cw = W * 1.15;
			const ch = cw * (cover.height / cover.width);
			ctx.translate(W / 2, H * 0.22);
			ctx.drawImage(cover, -cw / 2, -ch / 2, cw, ch);
		} else {
			const ch = H * 1.05;
			const cw = ch * (cover.width / cover.height);
			ctx.translate(W * 0.78, H * 0.5);
			ctx.rotate((6 * Math.PI) / 180);
			ctx.shadowColor = "rgba(0,0,0,0.35)";
			ctx.shadowBlur = 6 * unit;
			ctx.shadowOffsetX = -1 * unit;
			ctx.drawImage(cover, -cw / 2, -ch / 2, cw, ch);
		}
		ctx.restore();
	}

	// --- text panel, clipped to a diagonal seam ---
	ctx.save();
	ctx.beginPath();
	if (stacked) {
		// Panel occupies the lower portion; its top edge slopes upward to the right.
		ctx.moveTo(0, H * 0.46);
		ctx.lineTo(W, H * 0.38);
		ctx.lineTo(W, H);
		ctx.lineTo(0, H);
	} else {
		// Panel occupies the left portion; its right edge leans.
		ctx.moveTo(0, 0);
		ctx.lineTo(W * 0.70, 0);
		ctx.lineTo(W * 0.60, H);
		ctx.lineTo(0, H);
	}
	ctx.closePath();
	ctx.clip();

	const grad = stacked
		? ctx.createLinearGradient(0, H * 0.38, W, H)
		: ctx.createLinearGradient(0, 0, W * 0.7, H);
	grad.addColorStop(0, "#2f2f2f");
	grad.addColorStop(1, "#4a4a48");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, W, H);
	ctx.restore();

	// --- text content ---
	const panel = stacked
		? { x: 6 * unit, y: H * 0.52, w: W - 12 * unit, h: H * 0.36 }
		: { x: 6 * unit, y: 6 * unit, w: W * 0.56 - 6 * unit, h: H - 24 * unit };

	const textX = panel.x + 3.2 * unit;
	const textW = panel.w - 3.2 * unit;

	// The attribution is sized independently of the quote so we can reserve its height
	// *before* fitting. Deriving it from the fitted size instead would be circular, and
	// letting the quote consume the whole panel is what pushed the byline off-canvas.
	const titleSize = 2.6 * unit;
	const attributionHeight = titleSize * 1.35 + titleSize * 0.88 + titleSize * 0.9;

	const fitted = fitText(
		ctx,
		SAMPLE_QUOTE,
		{ w: textW, h: panel.h - attributionHeight },
		1.42,
		{ min: 2 * unit, max: 9 * unit }
	);

	ctx.font = `400 ${fitted.size}px ${SERIF}`;
	ctx.fillStyle = "#ffffff";
	ctx.textBaseline = "top";

	let y = panel.y;
	for (const line of fitted.lines) {
		ctx.fillText(line, textX, y);
		y += fitted.lineHeight;
	}

	// Accent bar sized to the actual text block now that we know its height.
	ctx.fillStyle = "rgba(255,255,255,0.85)";
	ctx.fillRect(panel.x, panel.y, 0.7 * unit, y - panel.y - fitted.lineHeight * 0.25);

	// --- attribution ---
	y += titleSize * 0.9;
	ctx.font = `500 ${titleSize}px ${SANS}`;
	ctx.fillStyle = "rgba(255,255,255,0.95)";
	ctx.fillText("Exercised", textX, y);

	y += titleSize * 1.35;
	ctx.font = `400 ${titleSize * 0.88}px ${SANS}`;
	ctx.fillStyle = "rgba(255,255,255,0.62)";
	ctx.fillText("Daniel Lieberman", textX, y);
}
