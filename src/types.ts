/** Where the cover art lives. Resolved to bytes later, by the palette/render layer. */
export type CoverRef =
	| { kind: "vault"; path: string }
	| { kind: "url"; url: string };

/** Everything the renderer needs about *what* to draw, independent of *how*. */
export interface QuoteSource {
	quote: string;
	title?: string;
	author?: string;
	cover?: CoverRef;
}

export type RatioKey = "16:9" | "1:1" | "4:5" | "9:16";

export const RATIOS: Record<RatioKey, { w: number; h: number }> = {
	"16:9": { w: 1920, h: 1080 },
	"1:1": { w: 1400, h: 1400 },
	"4:5": { w: 1200, h: 1500 },
	"9:16": { w: 1080, h: 1920 },
};
