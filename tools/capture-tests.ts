/**
 * Dev-only checks for the capture layer. Run with `npm run test:capture`.
 *
 * The capture functions are pure, so they can be exercised against a fake Editor
 * without launching Obsidian. Not a substitute for in-app testing, but it catches
 * the regex-level mistakes that are easy to make here.
 */
import { captureFromEditor } from "../src/capture/selection";
import { parseCite } from "../src/capture/metadata";

/** Minimal stand-in for Obsidian's Editor covering only what capture uses. */
function fakeEditor(content: string, cursorLine = 0, selection = "") {
	const lines = content.split("\n");
	return {
		getSelection: () => selection,
		getCursor: () => ({ line: cursorLine, ch: 0 }),
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
	} as unknown as Parameters<typeof captureFromEditor>[0];
}

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) passed++;
	else failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
}

// --- selection takes priority, markdown is stripped ---
check(
	"selection with highlight + bold markers",
	captureFromEditor(fakeEditor("body", 0, "The ==quick== and **brave** fox."))?.text,
	"The quick and brave fox."
);

check(
	"selection spanning soft-wrapped lines collapses to one paragraph",
	captureFromEditor(fakeEditor("x", 0, "One line\nand its continuation."))?.text,
	"One line and its continuation."
);

check(
	"paragraph breaks survive",
	captureFromEditor(fakeEditor("x", 0, "First para.\n\nSecond para."))?.text,
	"First para.\n\nSecond para."
);

// --- blockquote / callout capture at the cursor ---
const callout = [
	"---",
	"author: Someone",
	"---",
	"",
	"> [!quote] Chapter Three",
	"> Light, intermittent activities reduce levels of fat",
	"> and sugar in your blood.",
	"> — <cite>Daniel Lieberman, Exercised</cite>",
	"",
	"Trailing paragraph.",
].join("\n");

check(
	"callout body is captured without markers, header or cite",
	captureFromEditor(fakeEditor(callout, 5))?.text,
	"Light, intermittent activities reduce levels of fat and sugar in your blood."
);

check(
	"callout header title is lifted out of the quote body",
	captureFromEditor(fakeEditor(callout, 5))?.calloutTitle,
	"Chapter Three"
);

check(
	"cite is extracted from the callout",
	captureFromEditor(fakeEditor(callout, 5))?.cite,
	"Daniel Lieberman, Exercised"
);

check(
	"plain blockquote at cursor",
	captureFromEditor(fakeEditor("> A quoted line.\n> Continued here.", 1))?.text,
	"A quoted line. Continued here."
);

// --- plain paragraph capture, and the frontmatter guard ---
const plain = [
	"---",
	"author: Jodi McAlister",
	"source: An Academic Affair",
	"---",
	"Eucatastrophe is the good catastrophe,",
	"the sudden joyous turn.",
].join("\n");

check(
	"paragraph capture stops at frontmatter",
	captureFromEditor(fakeEditor(plain, 4))?.text,
	"Eucatastrophe is the good catastrophe, the sudden joyous turn."
);

check(
	"list-item highlight loses its bullet",
	captureFromEditor(fakeEditor("- A highlighted sentence.", 0))?.text,
	"A highlighted sentence."
);

check(
	"wikilinks and footnotes are flattened",
	captureFromEditor(fakeEditor("x", 0, "See [[Note Title|the note]] for more.[^1]"))?.text,
	"See the note for more."
);

check("empty capture returns null", captureFromEditor(fakeEditor("", 0)), null);

check(
	"blank line at cursor yields nothing",
	captureFromEditor(fakeEditor("text\n\nmore", 1)),
	null
);

// --- cite parsing ---
check("cite: author, title", parseCite("Daniel Lieberman, Exercised"), {
	author: "Daniel Lieberman",
	title: "Exercised",
});
check("cite: bare author", parseCite("Ursula K. Le Guin"), { author: "Ursula K. Le Guin" });
check("cite: leading dash stripped", parseCite("— Someone, A Book"), {
	author: "Someone",
	title: "A Book",
});

// --- report ---
if (failures.length) {
	console.error(`\n${failures.length} failing:\n`);
	for (const f of failures) console.error(`  ✗ ${f}\n`);
	process.exit(1);
}
console.log(`✓ ${passed} capture checks passed`);
