import type { RatioKey } from "./types";

export interface ShareQuoteSettings {
	/**
	 * Frontmatter keys consulted in order, first match wins. Defaults cover the
	 * conventions used by Readwise exports, Zotero/citation notes, and hand-written
	 * notes (e.g. `source:` for the work's title, `cover_image:` for the cover).
	 */
	titleKeys: string[];
	authorKeys: string[];
	coverKeys: string[];

	defaultRatio: RatioKey;
	/** Multiplier applied to the base ratio dimensions on export. */
	exportScale: number;
	/** Vault folder for saved images. Empty means the vault root. */
	outputFolder: string;
}

export const DEFAULT_SETTINGS: ShareQuoteSettings = {
	titleKeys: ["title", "source", "book", "work", "publication"],
	authorKeys: ["author", "authors", "creator", "by"],
	// `cover_image` leads deliberately. Generic keys like `image` and `banner` are
	// kept as fallbacks but rank last, since other plugins and themes use them for
	// unrelated purposes (note banners, social preview images).
	coverKeys: ["cover_image", "coverImage", "cover", "thumbnail", "image", "banner"],
	defaultRatio: "4:5",
	// The base ratio sizes are already at social-native resolution (4:5 is
	// 1200x1500), so 1x is the sensible default; 2x is for extra crispness.
	exportScale: 1,
	outputFolder: "Share Quote",
};
