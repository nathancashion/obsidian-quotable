/**
 * A minimal ZIP writer (store method, no compression).
 *
 * Used as the fallback when no directory picker is available. Writing one archive
 * rather than firing several downloads at once matters: Chromium treats a burst of
 * programmatic downloads from one origin as "multiple automatic downloads" and
 * blocks all but the first, which is a silent failure the user cannot diagnose.
 *
 * PNGs are already deflate-compressed internally, so storing them uncompressed
 * costs almost nothing and keeps this small enough to have no dependency.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed time and date, which is what the ZIP format stores. */
function dosDateTime(date: Date): { time: number; dateValue: number } {
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		dateValue:
			((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

export function createZip(entries: ZipEntry[]): Blob {
	const encoder = new TextEncoder();
	const { time, dateValue } = dosDateTime(new Date());

	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		const size = entry.data.length;

		const local = new Uint8Array(30 + nameBytes.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true); // local file header signature
		lv.setUint16(4, 20, true); // version needed
		lv.setUint16(6, 0x0800, true); // flags: bit 11 marks the name as UTF-8
		lv.setUint16(8, 0, true); // method: stored
		lv.setUint16(10, time, true);
		lv.setUint16(12, dateValue, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, size, true); // compressed size
		lv.setUint32(22, size, true); // uncompressed size
		lv.setUint16(26, nameBytes.length, true);
		lv.setUint16(28, 0, true); // extra field length
		local.set(nameBytes, 30);

		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true); // central directory signature
		cv.setUint16(4, 20, true); // version made by
		cv.setUint16(6, 20, true); // version needed
		cv.setUint16(8, 0x0800, true);
		cv.setUint16(10, 0, true);
		cv.setUint16(12, time, true);
		cv.setUint16(14, dateValue, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, size, true);
		cv.setUint32(24, size, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint16(30, 0, true); // extra
		cv.setUint16(32, 0, true); // comment
		cv.setUint16(34, 0, true); // disk number
		cv.setUint16(36, 0, true); // internal attributes
		cv.setUint32(38, 0, true); // external attributes
		cv.setUint32(42, offset, true); // offset of local header
		central.set(nameBytes, 46);

		locals.push(local, entry.data);
		centrals.push(central);
		offset += local.length + size;
	}

	const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);

	const end: Uint8Array = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true); // end of central directory signature
	ev.setUint16(4, 0, true); // this disk
	ev.setUint16(6, 0, true); // disk with central directory
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	ev.setUint16(20, 0, true); // comment length

	// Concatenated into one buffer and handed to Blob as an ArrayBuffer. Passing an
	// array of Uint8Arrays is equivalent at runtime but trips TypeScript's
	// ArrayBufferLike narrowing, and a single copy of a few hundred KB is free.
	const chunks = [...locals, ...centrals, end];
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(total);
	let cursor = 0;
	for (const chunk of chunks) {
		out.set(chunk, cursor);
		cursor += chunk.length;
	}

	return new Blob([out.buffer], { type: "application/zip" });
}
