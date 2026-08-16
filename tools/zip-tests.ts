/**
 * Dev-only checks for the ZIP writer. Run with `npm run test:zip`.
 *
 * Validation is delegated to the system `unzip`, which verifies every entry's CRC
 * against its stored bytes. Checking our own output with our own parser would only
 * prove we are self-consistent; an external tool proves the archive is really a ZIP.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createZip } from "../src/export/zip";

const encoder = new TextEncoder();

const entries = [
	{ name: "Quotable 16x9.png", data: encoder.encode("payload for the wide one") },
	{ name: "Quotable 1x1.png", data: encoder.encode("a longer, quite different payload") },
	// Larger than any header, to catch offset arithmetic mistakes.
	{ name: "Quotable 4x5.png", data: new Uint8Array(5000).fill(7) },
	// Non-ASCII, which is why the UTF-8 flag bit is set in both headers.
	{ name: "Quotable 9x16 — café.png", data: encoder.encode("unicode name") },
];

const zip = createZip(entries);

const run = async () => {
	const bytes = Buffer.from(await zip.arrayBuffer());
	const dir = mkdtempSync(join(tmpdir(), "quotable-zip-"));
	const path = join(dir, "collection.zip");
	writeFileSync(path, bytes);

	const failures: string[] = [];

	if (zip.type !== "application/zip") failures.push(`wrong mime type: ${zip.type}`);

	// -t walks every entry and recomputes its CRC.
	try {
		execFileSync("unzip", ["-t", path], { stdio: "pipe" });
	} catch (err) {
		failures.push(`unzip -t rejected the archive:\n${(err as Error).message}`);
	}

	// Names, sizes and contents are checked with Python's zipfile rather than
	// `unzip -l`. macOS ships Info-ZIP 6.00 (2009), which ignores the UTF-8 name
	// flag when printing a listing and mangles non-ASCII names on screen — the
	// archive is fine, the 2009 display code is not.
	let parsed: { names: string[]; sizes: number[]; contents: string[]; bad: string | null };
	try {
		const json = execFileSync(
			"python3",
			[
				"-c",
				`import json,zipfile
z = zipfile.ZipFile(${JSON.stringify(path)})
info = z.infolist()
print(json.dumps({
  "names": [i.filename for i in info],
  "sizes": [i.file_size for i in info],
  "contents": [z.read(i.filename).decode("utf-8", "replace") for i in info],
  "bad": z.testzip(),
}))`,
			],
			{ encoding: "utf8" }
		);
		parsed = JSON.parse(json);
	} catch (err) {
		failures.push(`could not read the archive back: ${(err as Error).message}`);
		parsed = { names: [], sizes: [], contents: [], bad: null };
	}

	if (parsed.bad) failures.push(`corrupt entry reported: ${parsed.bad}`);

	entries.forEach((entry, i) => {
		if (parsed.names[i] !== entry.name) {
			failures.push(`name ${i}: expected ${entry.name}, got ${parsed.names[i]}`);
		}
		if (parsed.sizes[i] !== entry.data.length) {
			failures.push(`size ${i}: expected ${entry.data.length}, got ${parsed.sizes[i]}`);
		}
	});

	// Round-trip the bytes of the first entry, so this tests content and not just metadata.
	if (parsed.contents[0] !== "payload for the wide one") {
		failures.push(`content round-trip failed: got ${JSON.stringify(parsed.contents[0])}`);
	}

	if (failures.length) {
		console.error(`\n${failures.length} failing:\n`);
		for (const f of failures) console.error(`  ✗ ${f}\n`);
		process.exit(1);
	}
	console.log(`✓ zip archive validated by unzip and python zipfile (${entries.length} entries)`);
};

void run();
