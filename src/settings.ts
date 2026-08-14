import type { StyleKey } from "./render/styles";
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
	defaultStyle: StyleKey;
	/** Multiplier applied to the base ratio dimensions on export. */
	exportScale: number;
	/** Vault folder for saved images. Empty means the vault root. */
	outputFolder: string;
	/** Draw with the current Obsidian theme's fonts instead of the style's own. */
	useThemeFonts: boolean;
}

export const DEFAULT_SETTINGS: ShareQuoteSettings = {
	titleKeys: ["title", "source", "book", "work", "publication"],
	authorKeys: ["author", "authors", "creator", "by"],
	// `cover_image` leads deliberately. Generic keys like `image` and `banner` are
	// kept as fallbacks but rank last, since other plugins and themes use them for
	// unrelated purposes (note banners, social preview images).
	coverKeys: ["cover_image", "coverImage", "cover", "thumbnail", "image", "banner"],
	defaultRatio: "4:5",
	defaultStyle: "pretty",
	// The base ratio sizes are already at social-native resolution (4:5 is
	// 1200x1500), so 1x is the sensible default; 2x is for extra crispness.
	exportScale: 1,
	outputFolder: "Share Quote",
	useThemeFonts: false,
};

/** Parse a comma-separated settings field into a clean key list. */
export function parseKeyList(value: string): string[] {
	return value
		.split(",")
		.map((key) => key.trim())
		.filter(Boolean);
}

/**
 * Resolve the current theme's fonts for use on canvas.
 *
 * Canvas can't read CSS custom properties, so the values are resolved to concrete
 * font stacks at render time. Obsidian always defines both, but fall back to the
 * style's own family if a theme has removed them.
 */
export function resolveThemeFonts(): { quote?: string; meta?: string } {
	const styles = getComputedStyle(document.body);
	const quote = styles.getPropertyValue("--font-text").trim();
	const meta = styles.getPropertyValue("--font-interface").trim();
	return { quote: quote || undefined, meta: meta || undefined };
}
