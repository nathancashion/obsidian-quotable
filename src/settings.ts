import { STYLE_LABELS, type StyleKey } from "./render/styles";
import { RATIOS, type RatioKey } from "./types";

/** Scales offered in settings. Anything else in a saved file is reset. */
export const EXPORT_SCALES = [1, 2, 3] as const;
export type ExportScale = (typeof EXPORT_SCALES)[number];

export interface QuotableSettings {
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
	exportScale: ExportScale;
	/** Vault folder for saved images. Empty means the vault root. */
	outputFolder: string;
	/** Draw with the current Obsidian theme's fonts instead of the style's own. */
	useThemeFonts: boolean;
}

export const DEFAULT_SETTINGS: QuotableSettings = {
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
	outputFolder: "Quotable",
	useThemeFonts: false,
};

/**
 * Build settings from whatever `loadData()` returned.
 *
 * The settings tab's `validate` only gates what the user types; it never sees a
 * saved file. So each field is checked here, and anything missing, mistyped, or no
 * longer offered (a hand-edited file, a value from an older version) falls back to
 * its default rather than reaching the renderer. Arrays are always fresh copies, so
 * editing the settings can never mutate DEFAULT_SETTINGS.
 */
export function normalizeSettings(stored: unknown): QuotableSettings {
	const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
	const d = DEFAULT_SETTINGS;

	const keyList = (value: unknown, fallback: string[]): string[] => {
		const keys = Array.isArray(value)
			? value.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean)
			: [];
		return keys.length ? keys : [...fallback];
	};
	const oneOf = <T extends string>(value: unknown, options: Record<T, unknown>, fallback: T): T =>
		typeof value === "string" && Object.prototype.hasOwnProperty.call(options, value)
			? (value as T)
			: fallback;

	return {
		titleKeys: keyList(s.titleKeys, d.titleKeys),
		authorKeys: keyList(s.authorKeys, d.authorKeys),
		coverKeys: keyList(s.coverKeys, d.coverKeys),
		defaultRatio: oneOf(s.defaultRatio, RATIOS, d.defaultRatio),
		defaultStyle: oneOf(s.defaultStyle, STYLE_LABELS, d.defaultStyle),
		exportScale: (EXPORT_SCALES as readonly unknown[]).includes(s.exportScale)
			? (s.exportScale as ExportScale)
			: d.exportScale,
		outputFolder: typeof s.outputFolder === "string" ? s.outputFolder.trim() : d.outputFolder,
		useThemeFonts: typeof s.useThemeFonts === "boolean" ? s.useThemeFonts : d.useThemeFonts,
	};
}

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
