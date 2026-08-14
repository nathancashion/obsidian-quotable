import { RATIOS, type QuoteSource, type RatioKey } from "../types";
import { computeLayout, coverScale, type Layout } from "./layouts";
import { STYLES, type Palette, type StyleKey, type StyleTraits } from "./styles";
import {
	drawStyledLines,
	fitSingleLine,
	fitTextToBox,
	fitWrappedLines,
	type FontSpec,
	type StyledFontSpec,
} from "./text";

/**
 * The single renderer. Both the live preview and the exported PNG call this, so
 * what the user sees is what they get, with no rasterization step in between.
 */

/** Longest a title may run before it is shrunk and then truncated. */
const TITLE_MAX_LINES = 2;

/**
 * Attribution font size, given the size the quote fitted to.
 *
 * Three rules, in strict priority order:
 *
 *  1. It must always read as smaller than the quote. The attribution is secondary
 *     information, and a byline that rivals the quote inverts the hierarchy of the
 *     card. This is a hard ceiling — nothing below may override it.
 *  2. Subject to that, it should be as legible as possible. A card viewed
 *     full-width on a phone displays at roughly a third of its pixel size, so the
 *     floor aims to land the title near 16pt as seen.
 *  3. Otherwise it tracks the quote proportionally.
 *
 * Rule 1 has to dominate because the floor and the proportion disagree whenever a
 * quote is long enough to fit at a small size: the floor would then push the
 * attribution past the quote, which is exactly the inversion rule 1 forbids.
 */
export function attributionSize(quoteSize: number, unit: number): number {
	const subordinate = quoteSize * 0.8;
	const legible = 4.2 * unit;
	const proportional = quoteSize * 0.75;
	return Math.min(Math.max(proportional, legible), subordinate, 5.6 * unit);
}

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
	// Cover URLs often point at thumbnails (Amazon's `_SY160`, for one), so the
	// image is frequently upscaled several times over. Smoothing is the difference
	// between a soft background and a visibly blocky one.
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";

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

	const barGutter = traits.accentBar ? 3.2 * unit : 0;
	const textX = content.x + barGutter;
	const textW = content.w - barGutter;

	const titleFont: FontSpec = (s) => `600 ${s}px ${traits.metaFamily}`;
	const authorFont: FontSpec = (s) => `400 ${s}px ${traits.metaFamily}`;

	// Bold maps to 700 regardless of the style's base weight; italic relies on the
	// family having a real italic, which every serif and sans in our stacks does.
	const quoteFont: StyledFontSpec = (size, bold, italic) =>
		`${italic ? "italic " : ""}${bold ? 700 : traits.quoteWeight} ${size}px ${traits.quoteFamily}`;

	/** Everything about the attribution block that follows from its font size. */
	const measureMeta = (metaSize: number) => {
		const lineHeight = metaSize * 1.32;
		// Wrapping the title here yields its exact line count, so the height reserved
		// below is right whether it takes one line or two.
		const title = hasTitle
			? fitWrappedLines(
					ctx,
					source.title!.trim(),
					textW,
					titleFont,
					metaSize,
					TITLE_MAX_LINES
				)
			: null;
		// The gap is reserved unconditionally, so it must be generous enough to look
		// right when the quote fills the panel exactly and no slack remains to widen it.
		const gap = metaSize * 1.9;
		const height = hasMeta
			? gap +
				(title ? title.lines.length * lineHeight : 0) +
				(hasAuthor ? lineHeight : 0)
			: 0;
		return { metaSize, lineHeight, title, gap, height };
	};

	const fitQuote = (metaHeight: number) =>
		fitTextToBox(
			ctx,
			source.quote,
			{ w: textW, h: content.h - metaHeight },
			{
				font: quoteFont,
				lineHeightRatio: traits.lineHeightRatio,
				minSize: 1.8 * unit,
				// Capped well below the box height on purpose. Letting a short quote grow
				// until it fills the panel produces billboard-sized text that reads as a
				// mistake; past this size the card should gain whitespace, not type.
				maxSize: 6 * unit,
			}
		);

	// Attribution size is derived from the fitted quote rather than from the card.
	// Sizing it from the card alone lets the two drift apart — a short quote fills
	// the panel with large type while the byline stays small and looks like an
	// afterthought. That is circular (the quote fit depends on the space the
	// attribution reserves), so it is resolved in two passes: fit once against a
	// nominal reservation to learn the quote size, then re-fit against the real one.
	let meta = measureMeta(3.2 * unit);
	let fitted = fitQuote(meta.height);
	meta = measureMeta(attributionSize(fitted.size, unit));
	fitted = fitQuote(meta.height);

	const { metaSize, lineHeight: metaLineHeight, title, gap: metaGap, height: metaHeight } = meta;

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

	ctx.fillStyle = palette.text;
	const quoteEnd = drawStyledLines(ctx, fitted, textX, top, quoteFont);

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

	if (title) {
		ctx.font = titleFont(title.size);
		ctx.fillStyle = palette.text;
		for (const line of title.lines) {
			ctx.fillText(line, textX, y);
			y += metaLineHeight;
		}
	}

	if (hasAuthor) {
		// The byline is a name, so it stays on one line and shrinks if it must.
		const author = fitSingleLine(
			ctx,
			source.author!.trim(),
			textW,
			authorFont,
			metaSize * 0.92
		);
		ctx.font = authorFont(author.size);
		ctx.fillStyle = palette.muted;
		ctx.fillText(author.text, textX, y);
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
