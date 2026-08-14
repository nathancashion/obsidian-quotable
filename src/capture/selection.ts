import type { Editor } from "obsidian";

/**
 * Pulling quotable text out of a note.
 *
 * Two entry points, in priority order: whatever the user selected, or — if nothing
 * is selected — the block the cursor sits in. "Block" means an enclosing blockquote
 * or callout when there is one, otherwise the surrounding paragraph.
 */

export interface CapturedText {
	/** Cleaned quote text, ready to render. */
	text: string;
	/** Contents of a `<cite>` element found in the block, if any. */
	cite?: string;
	/** Title from a callout header, e.g. "Chapter Three" in `> [!quote] Chapter Three`. */
	calloutTitle?: string;
	hadSelection: boolean;
}

const CITE_RE = /<cite>([\s\S]*?)<\/cite>/i;
const BLOCKQUOTE_RE = /^\s*>/;
// Applied *after* blockquote markers are stripped, so no leading `>` here.
const CALLOUT_HEADER_RE = /^\s*\[!([^\]]+)\][+-]?\s*(.*)$/;

/** Strip one level of `>` markers from every line of a blockquote block. */
function stripBlockquote(lines: string[]): string[] {
	return lines.map((l) => l.replace(/^\s*>\s?/, ""));
}

/**
 * Remove markdown that shouldn't appear as literal characters in a rendered image.
 *
 * Emphasis markers are kept by default: the renderer parses them into styled runs,
 * so the quote must reach it as markdown. They are stripped only where the target
 * is drawn in a single fixed style, i.e. the attribution lines.
 */
function stripInlineMarkdown(text: string, stripEmphasis = false): string {
	const withoutEmphasis = (value: string) =>
		value
			.replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			// Bold is already gone, so any remaining `*` pair is emphasis.
			// Deliberately no lookbehind here: iOS Safari lacked support before 16.4.
			.replace(/\*([^*]+)\*/g, "$1");

	const result = (
		text
			// Wikilinks and embeds: keep the display text.
			.replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
			.replace(/!?\[\[([^\]]+)\]\]/g, "$1")
			// Markdown links: keep the label.
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			// Footnote references.
			.replace(/\[\^[^\]]+\]/g, "")
			// Highlight, strikethrough and code markers carry no styling in the card.
			.replace(/==([^=]+)==/g, "$1")
			.replace(/~~([^~]+)~~/g, "$1")
			.replace(/`([^`]+)`/g, "$1")
			// Obsidian block references at end of line.
			.replace(/\s*\^[a-zA-Z0-9-]+\s*$/g, "")
	);

	return stripEmphasis ? withoutEmphasis(result) : result;
}

/** Normalize a captured block into a clean quote string plus any callout title. */
function cleanBlock(raw: string): { text: string; calloutTitle?: string } {
	let lines = raw.split("\n");

	if (lines.some((l) => BLOCKQUOTE_RE.test(l))) {
		lines = stripBlockquote(lines);
	}

	// A callout header names the block; it isn't part of what was said, so it is
	// lifted out rather than folded into the quote body.
	let calloutTitle: string | undefined;
	if (lines.length) {
		const header = CALLOUT_HEADER_RE.exec(lines[0]);
		if (header) {
			calloutTitle = header[2].trim() || undefined;
			lines[0] = "";
		}
	}

	lines = lines
		// Readwise and similar exports store highlights as list items.
		.map((l) => l.replace(/^\s*[-*+]\s+/, ""))
		.map((l) => stripInlineMarkdown(l));

	let text = lines.join("\n").trim();

	// Collapse soft-wrapped lines into spaces while preserving paragraph breaks.
	// Splitting on the blank-line boundary first avoids the two passes clobbering
	// each other (a naive newline->space pass destroys paragraph information).
	text = text
		.split(/\n{2,}/)
		.map((p) => p.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n\n");

	// A block wrapped entirely in quote marks doesn't need them repeated in the card.
	const wrapped = /^["\u201C\u2018']([\s\S]+)["\u201D\u2019']$/.exec(text);
	if (wrapped) text = wrapped[1].trim();

	return { text, calloutTitle };
}

/** Split a raw block into its quote body and any `<cite>` attribution. */
function extractCite(raw: string): { body: string; cite?: string } {
	const match = CITE_RE.exec(raw);
	if (!match) return { body: raw };

	// The attribution is drawn in one fixed style, so emphasis markers there would
	// only show up as literal asterisks.
	const cite = stripInlineMarkdown(match[1], true).trim();
	// Remove the cite element and any leading dash/em-dash that introduced it.
	const body = raw.replace(CITE_RE, "").replace(/\s*[-–—]+\s*$/gm, "");
	return { body, cite };
}

/** First line of note body, i.e. the line after any YAML frontmatter. */
function bodyStartLine(editor: Editor): number {
	if (editor.getLine(0).trim() !== "---") return 0;
	for (let i = 1; i < editor.lineCount(); i++) {
		if (editor.getLine(i).trim() === "---") return i + 1;
	}
	return 0;
}

/**
 * Expand from `line` to the enclosing block.
 * Blockquotes/callouts expand across `>`-prefixed lines; anything else expands
 * across contiguous non-blank lines.
 */
function expandBlock(editor: Editor, line: number): { from: number; to: number } | null {
	const min = bodyStartLine(editor);
	const max = editor.lineCount() - 1;
	if (line < min || line > max) return null;

	const isQuote = BLOCKQUOTE_RE.test(editor.getLine(line));
	const matches = (n: number) => {
		const text = editor.getLine(n);
		return isQuote ? BLOCKQUOTE_RE.test(text) : text.trim().length > 0;
	};

	if (!matches(line)) return null;

	let from = line;
	let to = line;
	while (from - 1 >= min && matches(from - 1)) from--;
	while (to + 1 <= max && matches(to + 1)) to++;
	return { from, to };
}

export function captureFromEditor(editor: Editor): CapturedText | null {
	const selection = editor.getSelection();

	const raw = (() => {
		if (selection.trim()) return selection;
		const block = expandBlock(editor, editor.getCursor().line);
		if (!block) return "";
		const lines: string[] = [];
		for (let i = block.from; i <= block.to; i++) lines.push(editor.getLine(i));
		return lines.join("\n");
	})();

	if (!raw.trim()) return null;

	const { body, cite } = extractCite(raw);
	const { text, calloutTitle } = cleanBlock(body);
	if (!text) return null;

	return { text, cite, calloutTitle, hadSelection: !!selection.trim() };
}
