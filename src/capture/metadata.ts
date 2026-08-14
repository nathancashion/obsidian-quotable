import type { App, TFile } from "obsidian";
import type { ShareQuoteSettings } from "../settings";
import type { CoverRef, QuoteSource } from "../types";
import type { CapturedText } from "./selection";

/**
 * Resolving who said it and where it came from.
 *
 * Sources are consulted in descending order of specificity: an explicit `<cite>`
 * in the quote block beats frontmatter, which beats the note's own title. Nothing
 * here is authoritative — every field stays editable in the share modal.
 */

/** Read the first frontmatter key that carries a usable value. */
function firstKey(
	frontmatter: Record<string, unknown> | undefined,
	keys: string[]
): string | undefined {
	if (!frontmatter) return undefined;
	// Match case-insensitively; frontmatter casing is inconsistent in the wild.
	const lookup = new Map(Object.keys(frontmatter).map((k) => [k.toLowerCase(), k]));
	for (const key of keys) {
		const actual = lookup.get(key.toLowerCase());
		if (actual === undefined) continue;
		const value = frontmatter[actual];
		if (value === null || value === undefined) continue;
		// `authors: [A, B]` is common; join rather than dropping the rest.
		const text = Array.isArray(value)
			? value.filter(Boolean).map(String).join(", ")
			: String(value);
		if (text.trim()) return text.trim();
	}
	return undefined;
}

/**
 * Split a cite string into author and title.
 *
 * `<cite>Daniel Lieberman, Exercised</cite>` is the common shape, so we assume
 * author-first and split on the first comma. Ambiguous by nature — the modal lets
 * the user swap them.
 */
export function parseCite(cite: string): { author?: string; title?: string } {
	const clean = cite.replace(/^\s*[-–—]\s*/, "").trim();
	if (!clean) return {};

	const comma = clean.indexOf(",");
	if (comma === -1) return { author: clean };

	const author = clean.slice(0, comma).trim();
	const title = clean.slice(comma + 1).trim();
	return { author: author || undefined, title: title || undefined };
}

const URL_RE = /^(https?:)?\/\//i;

/** Turn a frontmatter cover value into something loadable. */
function resolveCover(
	app: App,
	file: TFile,
	value: string | undefined
): CoverRef | undefined {
	if (!value) return undefined;

	// Strip wikilink/markdown-image wrappers people put around cover paths.
	let ref = value.trim();
	const wiki = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(ref);
	if (wiki) ref = wiki[1].trim();
	const md = /^!?\[[^\]]*\]\(([^)]+)\)$/.exec(ref);
	if (md) ref = md[1].trim();
	ref = ref.replace(/^<|>$/g, "").trim();

	if (URL_RE.test(ref)) return { kind: "url", url: ref };

	// Resolve relative to the note, the way Obsidian resolves links.
	const target = app.metadataCache.getFirstLinkpathDest(ref, file.path);
	if (target) return { kind: "vault", path: target.path };

	// Fall back to a literal vault path if the link resolver came up empty.
	const literal = app.vault.getAbstractFileByPath(ref);
	return literal ? { kind: "vault", path: ref } : undefined;
}

/** Note's first H1, used as a title fallback before the filename. */
function firstHeading(app: App, file: TFile): string | undefined {
	const headings = app.metadataCache.getFileCache(file)?.headings;
	return headings?.find((h) => h.level === 1)?.heading?.trim() || undefined;
}

export function resolveMetadata(
	app: App,
	file: TFile,
	captured: CapturedText,
	settings: ShareQuoteSettings
): QuoteSource {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
		| Record<string, unknown>
		| undefined;

	const fromCite = captured.cite ? parseCite(captured.cite) : {};

	return {
		quote: captured.text,
		author: fromCite.author ?? firstKey(frontmatter, settings.authorKeys),
		title:
			fromCite.title ??
			firstKey(frontmatter, settings.titleKeys) ??
			captured.calloutTitle ??
			firstHeading(app, file) ??
			file.basename,
		cover: resolveCover(app, file, firstKey(frontmatter, settings.coverKeys)),
	};
}
