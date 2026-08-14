import type { RatioKey } from "../types";
import { isStacked, type StyleTraits } from "./styles";

/**
 * Card geometry.
 *
 * All values are absolute pixels derived from the target canvas size, so the same
 * code serves a small preview and a 3x export without a separate scaling pass.
 */

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Layout {
	W: number;
	H: number;
	/** Scale-independent spacing unit: 1% of the short edge. */
	unit: number;
	stacked: boolean;
	/** Polygon of the text panel, in draw order. */
	panelPath: Array<[number, number]>;
	/** Text content box inside the panel. */
	content: Box;
	/** Region the cover art should fill. */
	coverRegion: Box;
	/** Cover rotation in radians. */
	coverRotation: number;
	/** Gradient axis for the panel fill. */
	gradient: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Per-ratio tuning: where the seam sits, and how much room the text gets.
 *
 * Padding is split by axis because the two do different work. `padX` sets the text
 * inset from the edge and wants to stay visually constant across ratios; `padY` is
 * headroom, and the wide ratios need proportionally more of it — at 16:9 the unit
 * is derived from the short edge, so a uniform pad leaves the text crowding the top.
 */
const TUNING: Record<RatioKey, { split: number; padX: number; padY: number }> = {
	// `split` is the seam position along the divided axis, as a fraction.
	"16:9": { split: 0.63, padX: 7, padY: 11 },
	"1:1": { split: 0.68, padX: 7, padY: 8 },
	"4:5": { split: 0.46, padX: 7, padY: 7 },
	"9:16": { split: 0.42, padX: 7, padY: 7 },
};

export function computeLayout(
	ratio: RatioKey,
	W: number,
	H: number,
	style: StyleTraits,
	/** Whether cover art will actually be drawn. Drives whether there's a seam at all. */
	withCover: boolean
): Layout {
	const unit = Math.min(W, H) / 100;
	const stacked = isStacked(ratio);
	const { split, padX: padXUnits, padY: padYUnits } = TUNING[ratio];
	const padX = padXUnits * unit;
	const padY = padYUnits * unit;
	const skew = style.seamSkew;

	// With no cover there is nothing to divide, so the panel is the whole card and
	// the text centres on the card rather than in a half of it.
	if (!withCover) {
		return {
			W,
			H,
			unit,
			stacked,
			panelPath: [
				[0, 0],
				[W, 0],
				[W, H],
				[0, H],
			],
			content: { x: padX, y: padY, w: W - padX * 2, h: H - padY * 2 },
			coverRegion: { x: 0, y: 0, w: 0, h: 0 },
			coverRotation: 0,
			gradient: { x0: 0, y0: 0, x1: W * 0.6, y1: H },
		};
	}

	if (stacked) {
		// Cover on top, text panel below, seam rising to the right.
		const seamLeft = H * (split + skew);
		const seamRight = H * (split - skew);
		return {
			W,
			H,
			unit,
			stacked,
			panelPath: [
				[0, seamLeft],
				[W, seamRight],
				[W, H],
				[0, H],
			],
			content: {
				x: padX,
				y: seamLeft + padY,
				w: W - padX * 2,
				h: H - seamLeft - padY * 2,
			},
			// Extend past the seam so no backdrop shows through the diagonal.
			coverRegion: { x: 0, y: 0, w: W, h: seamLeft + unit },
			coverRotation: 0,
			gradient: { x0: 0, y0: seamRight, x1: W, y1: H },
		};
	}

	// Text panel on the left, cover bleeding off the right, seam leaning left.
	const seamTop = W * (split + skew);
	const seamBottom = W * (split - skew);
	return {
		W,
		H,
		unit,
		stacked,
		panelPath: [
			[0, 0],
			[seamTop, 0],
			[seamBottom, H],
			[0, H],
		],
		content: {
			x: padX,
			y: padY,
			// Keep clear of the leaning seam by measuring to its narrowest point.
			w: Math.min(seamTop, seamBottom) - padX * 2,
			h: H - padY * 2,
		},
		coverRegion: {
			x: Math.min(seamTop, seamBottom),
			y: -H * 0.03,
			w: W - Math.min(seamTop, seamBottom),
			h: H * 1.06,
		},
		coverRotation: (6 * Math.PI) / 180,
		gradient: { x0: 0, y0: 0, x1: seamTop, y1: H },
	};
}

/** Scale factor that makes an image cover a box entirely (may crop). */
export function coverScale(
	img: { width: number; height: number },
	box: { w: number; h: number }
): number {
	return Math.max(box.w / img.width, box.h / img.height);
}
