import { RATIOS, type QuoteSource, type RatioKey } from "../types";
import { computeLayout, coverScale, type Layout } from "./layouts";
import { STYLES, type Palette, type StyleKey, type StyleTraits } from "./styles";
import { drawLines, fitTextToBox } from "./text";

/**
 * The single renderer. Both the live preview and the exported PNG call this, so
 * what the user sees is what they get, with no rasterization step in between.
 */

/** Anything drawable by ctx.drawImage that also reports intrinsic size. */
export type CoverImage = CanvasImageSource & { width: number; height: number };

export interface CardSpec {
	source: QuoteSource;
	ratio: RatioKey;
	style: StyleKey;
	palette: Palette;
	cover?: CoverImage | null;
	/** Multiplier on the base ratio dimensions. 1 for preview, 2–3 for export. */
	scale: number;
}

function tracePath(ctx: CanvasRenderingContext2D, points: Array<[number, number]>): void {
	ctx.beginPath();
	points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
	ctx.closePath();
}

function drawCover(
	ctx: CanvasRenderingContext2D,
	layout: Layout,
	cover: CoverImage,
	rotation: number
): void {
	const { coverRegion: region, unit } = layout;
	const cx = region.x + region.w / 2;
	const cy = region.y + region.h / 2;

	ctx.save();

	if (rotation) {
		ctx.translate(cx, cy);
		ctx.rotate(rotation);
		// A rotated cover reads as a physical object, so give it a shadow and let
		// it overflow its region rather than cropping to fill.
		ctx.shadowColor = "rgba(0,0,0,0.35)";
		ctx.shadowBlur = 6 * unit;
		ctx.shadowOffsetX = -1.2 * unit;
		const s = (region.h / cover.height) * 1.02;
		const w = cover.width * s;
		const h = cover.height * s;
		ctx.drawImage(cover, -w / 2, -h / 2, w, h);
	} else {
		// Flat regions are filled edge to edge, cropping the overflow. The crop is
		// anchored to the top rather than centred: cover art puts its title and
		// subject in the upper half, and centring a tall cover in a wide band
		// shows only the middle of the artwork.
		const s = coverScale(cover, region);
		const w = cover.width * s;
		const h = cover.height * s;
		ctx.drawImage(cover, region.x + (region.w - w) / 2, region.y, w, h);
	}

	ctx.restore();
}

function drawTextBlock(
	ctx: CanvasRenderingContext2D,
	layout: Layout,
	spec: CardSpec,
	traits: StyleTraits
): void {
	const { unit, content } = layout;
	const { palette, source } = spec;

	const hasTitle = !!source.title?.trim();
	const hasAuthor = !!source.author?.trim();
	const hasMeta = hasTitle || hasAuthor;

	// Attribution is sized from the card, not from the fitted quote: deriving it
	// from the quote size would be circular, and it must be reserved before fitting.
	const metaSize = 2.6 * unit;
	// Reserved unconditionally, so it must be generous enough to look right when the
	// quote fills the panel exactly and there is no slack left to widen it.
	const metaGap = metaSize * 1.9;
	const metaLines = (hasTitle ? 1 : 0) + (hasAuthor ? 1 : 0);
	const metaHeight = hasMeta ? metaGap + metaSize * 1.32 * metaLines : 0;

	const barGutter = traits.accentBar ? 3.2 * unit : 0;
	const textX = content.x + barGutter;
	const textW = content.w - barGutter;

	const fitted = fitTextToBox(
		ctx,
		source.quote,
		{ w: textW, h: content.h - metaHeight },
		{
			font: (size) => `${traits.quoteWeight} ${size}px ${traits.quoteFamily}`,
			lineHeightRatio: traits.lineHeightRatio,
			minSize: 1.8 * unit,
			// Capped well below the box height on purpose. Letting a short quote grow
			// until it fills the panel produces billboard-sized text that reads as a
			// mistake; past this size the card should gain whitespace, not type.
			maxSize: 6 * unit,
		}
	);

	// Centre the whole block (quote + attribution) in the panel so short quotes
	// don't strand a pool of empty space beneath them.
	//
	// The attribution gap has to be reserved before fitting, but looks cramped under
	// large type. Any leftover room after fitting is spent widening that gap first,
	// which keeps the result inside the box no matter how the fit landed.
	const slack = Math.max(0, content.h - (fitted.height + metaHeight));
	const extraGap = hasMeta ? Math.min(slack * 0.5, fitted.size * 0.7) : 0;
	const blockHeight = fitted.height + metaHeight + extraGap;
	const top = content.y + Math.max(0, (content.h - blockHeight) / 2);

	ctx.font = `${traits.quoteWeight} ${fitted.size}px ${traits.quoteFamily}`;
	ctx.fillStyle = palette.text;
	const quoteEnd = drawLines(ctx, fitted, textX, top);

	if (traits.accentBar) {
		ctx.fillStyle = palette.accent;
		ctx.fillRect(
			content.x,
			top,
			0.7 * unit,
			fitted.height - fitted.lineHeight * (traits.lineHeightRatio - 1)
		);
	}

	if (!hasMeta) return;

	let y = quoteEnd - fitted.lineHeight * (traits.lineHeightRatio - 1) + metaGap + extraGap;
	if (hasTitle) {
		ctx.font = `600 ${metaSize}px ${traits.metaFamily}`;
		ctx.fillStyle = palette.text;
		ctx.fillText(source.title!.trim(), textX, y);
		y += metaSize * 1.32;
	}
	if (hasAuthor) {
		ctx.font = `400 ${metaSize * 0.92}px ${traits.metaFamily}`;
		ctx.fillStyle = palette.muted;
		ctx.fillText(source.author!.trim(), textX, y);
	}
}

export function renderCard(canvas: HTMLCanvasElement, spec: CardSpec): void {
	const base = RATIOS[spec.ratio];
	const W = Math.round(base.w * spec.scale);
	const H = Math.round(base.h * spec.scale);

	canvas.width = W;
	canvas.height = H;

	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2D canvas context unavailable");

	const traits = STYLES[spec.style];
	const withCover = traits.showCover && !!spec.cover;
	const layout = computeLayout(spec.ratio, W, H, traits, withCover);

	ctx.clearRect(0, 0, W, H);
	ctx.fillStyle = spec.palette.backdrop;
	ctx.fillRect(0, 0, W, H);

	if (withCover && spec.cover) {
		drawCover(ctx, layout, spec.cover, layout.coverRotation);
	}

	// Panel gradient, clipped to the seam.
	ctx.save();
	tracePath(ctx, layout.panelPath);
	ctx.clip();
	const g = layout.gradient;
	const gradient = ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
	gradient.addColorStop(0, spec.palette.from);
	gradient.addColorStop(1, spec.palette.to);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, W, H);
	ctx.restore();

	drawTextBlock(ctx, layout, spec, traits);
}
