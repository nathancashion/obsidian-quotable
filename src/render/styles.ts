import type { RatioKey } from "../types";

/** Colors driving a single card. Produced by the palette extractor, or fixed. */
export interface Palette {
	id: string;
	/** Gradient endpoints for the text panel. */
	from: string;
	to: string;
	/** Area behind the cover art, visible where the art doesn't reach. */
	backdrop: string;
	text: string;
	muted: string;
	accent: string;
}

export type StyleKey = "pretty" | "clean" | "classic";

export const STYLE_LABELS: Record<StyleKey, string> = {
	pretty: "Pretty",
	clean: "Clean",
	classic: "Classic",
};

export interface StyleTraits {
	/** Whether the cover art is composited into the card. */
	showCover: boolean;
	/** Diagonal offset of the seam, as a fraction of the long edge. 0 = straight. */
	seamSkew: number;
	quoteFamily: string;
	metaFamily: string;
	quoteWeight: number;
	lineHeightRatio: number;
	/** Draw the vertical rule beside the quote. */
	accentBar: boolean;
}

const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif`;
const SANS = `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;

export const STYLES: Record<StyleKey, StyleTraits> = {
	pretty: {
		showCover: true,
		seamSkew: 0.06,
		quoteFamily: SERIF,
		metaFamily: SANS,
		quoteWeight: 400,
		lineHeightRatio: 1.42,
		accentBar: true,
	},
	clean: {
		showCover: false,
		seamSkew: 0,
		quoteFamily: SANS,
		metaFamily: SANS,
		quoteWeight: 400,
		lineHeightRatio: 1.5,
		accentBar: false,
	},
	classic: {
		showCover: false,
		seamSkew: 0,
		quoteFamily: SERIF,
		metaFamily: SERIF,
		quoteWeight: 400,
		lineHeightRatio: 1.55,
		accentBar: true,
	},
};

/**
 * Neutral palettes always offered alongside the cover-derived ones.
 *
 * Both are flat rather than graduated, and pure white/near-black rather than warm.
 * A cream tint reads as an unintended colour cast next to cover-derived palettes
 * that carry real colour.
 */
export const LIGHT_PALETTE: Palette = {
	id: "light",
	from: "#ffffff",
	to: "#ffffff",
	backdrop: "#ffffff",
	text: "#1c1c1c",
	muted: "rgba(0,0,0,0.55)",
	accent: "#1c1c1c",
};

export const DARK_PALETTE: Palette = {
	id: "dark",
	from: "#2b2b2b",
	to: "#4a4a48",
	backdrop: "#ffffff",
	text: "#ffffff",
	muted: "rgba(255,255,255,0.62)",
	accent: "rgba(255,255,255,0.85)",
};

/** Layout family. The four ratios collapse into two arrangements. */
export function isStacked(ratio: RatioKey): boolean {
	return ratio === "4:5" || ratio === "9:16";
}
