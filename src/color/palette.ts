import { DARK_PALETTE, LIGHT_PALETTE, type Palette } from "../render/styles";

/**
 * Deriving card colors from cover art.
 *
 * Median-cut quantization over a downsampled copy of the cover, then the most
 * visually salient buckets become gradient bases. Salience is population weighted
 * by saturation, so a cover that is 60% off-white paper doesn't yield four greys.
 */

type RGB = [number, number, number];

const SAMPLE_EDGE = 48;

/** Downsample to a small canvas and read the pixels back. */
function samplePixels(image: CanvasImageSource & { width: number; height: number }): RGB[] {
	const canvas = createEl("canvas");
	canvas.width = SAMPLE_EDGE;
	canvas.height = SAMPLE_EDGE;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return [];

	ctx.drawImage(image, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
	const { data } = ctx.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE);

	const pixels: RGB[] = [];
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 200) continue; // ignore transparent regions
		pixels.push([data[i], data[i + 1], data[i + 2]]);
	}
	return pixels;
}

function averageOf(pixels: RGB[]): RGB {
	const sum = pixels.reduce<[number, number, number]>(
		(acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
		[0, 0, 0]
	);
	const n = pixels.length || 1;
	return [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
}

/** Channel with the widest spread — the axis worth splitting on. */
function widestChannel(pixels: RGB[]): 0 | 1 | 2 {
	let best: 0 | 1 | 2 = 0;
	let bestRange = -1;
	for (const channel of [0, 1, 2] as const) {
		let min = 255;
		let max = 0;
		for (const p of pixels) {
			if (p[channel] < min) min = p[channel];
			if (p[channel] > max) max = p[channel];
		}
		if (max - min > bestRange) {
			bestRange = max - min;
			best = channel;
		}
	}
	return best;
}

function medianCut(pixels: RGB[], targetBuckets: number): RGB[][] {
	let buckets: RGB[][] = [pixels];
	while (buckets.length < targetBuckets) {
		// Always split the bucket with the widest spread; splitting the largest by
		// count alone tends to keep subdividing the background.
		buckets.sort((a, b) => {
			const spread = (bucket: RGB[]) => {
				const ch = widestChannel(bucket);
				let min = 255;
				let max = 0;
				for (const p of bucket) {
					if (p[ch] < min) min = p[ch];
					if (p[ch] > max) max = p[ch];
				}
				return (max - min) * Math.log2(bucket.length + 1);
			};
			return spread(b) - spread(a);
		});
		const target = buckets.shift();
		if (!target || target.length < 2) {
			if (target) buckets.push(target);
			break;
		}
		const ch = widestChannel(target);
		const sorted = [...target].sort((a, b) => a[ch] - b[ch]);
		const mid = sorted.length >> 1;
		buckets.push(sorted.slice(0, mid), sorted.slice(mid));
	}
	return buckets;
}

// --- color space helpers ---

function toHex([r, g, b]: RGB): string {
	return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function saturation([r, g, b]: RGB): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	return max === 0 ? 0 : (max - min) / max;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: RGB): number {
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

function shade([r, g, b]: RGB, factor: number): RGB {
	return factor >= 0
		? [r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor]
		: [r * (1 + factor), g * (1 + factor), b * (1 + factor)];
}

function distance(a: RGB, b: RGB): number {
	return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Turn one base color into a full card palette. */
export function paletteFromColor(base: RGB, id: string): Palette {
	// Pick whichever of white/black reads better on this background.
	const onWhite = contrastRatio(base, [255, 255, 255]);
	const onBlack = contrastRatio(base, [0, 0, 0]);
	const lightText = onWhite >= onBlack;

	// If neither passes comfortably, push the background away from mid-tone until
	// the winning text color has room to breathe.
	let adjusted = base;
	let guard = 0;
	while (contrastRatio(adjusted, lightText ? [255, 255, 255] : [0, 0, 0]) < 4.5 && guard++ < 12) {
		adjusted = shade(adjusted, lightText ? -0.08 : 0.08).map(Math.round) as RGB;
	}

	return {
		id,
		from: toHex(adjusted),
		to: toHex(shade(adjusted, lightText ? -0.28 : 0.22).map(Math.round) as RGB),
		backdrop: toHex(shade(adjusted, 0.72).map(Math.round) as RGB),
		text: lightText ? "#ffffff" : "#1c1c1c",
		muted: lightText ? "rgba(255,255,255,0.66)" : "rgba(0,0,0,0.58)",
		accent: lightText ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)",
	};
}

/**
 * Full swatch row for a card: up to four cover-derived palettes, then the fixed
 * light and dark options. Mirrors the picker in Readwise's share sheet.
 */
export function palettesFromCover(
	image: (CanvasImageSource & { width: number; height: number }) | null | undefined,
	count = 4
): Palette[] {
	const derived: Palette[] = [];

	if (image) {
		const pixels = samplePixels(image);
		if (pixels.length) {
			const buckets = medianCut(pixels, Math.max(count * 3, 8));
			const candidates = buckets
				.filter((b) => b.length)
				.map((b) => ({ color: averageOf(b), weight: b.length }))
				// Weight by saturation so vivid minorities beat dull majorities.
				.sort(
					(a, b) =>
						b.weight * (0.25 + saturation(b.color)) -
						a.weight * (0.25 + saturation(a.color))
				);

			for (const candidate of candidates) {
				if (derived.length >= count) break;
				// Skip near-duplicates of colors already chosen.
				const tooClose = derived.some(
					(p) => distance(hexToRgb(p.from), candidate.color) < 42
				);
				if (tooClose) continue;
				derived.push(paletteFromColor(candidate.color, `cover-${derived.length}`));
			}
		}
	}

	return [...derived, LIGHT_PALETTE, DARK_PALETTE];
}

export function hexToRgb(hex: string): RGB {
	const clean = hex.replace("#", "");
	const full =
		clean.length === 3
			? clean
					.split("")
					.map((c) => c + c)
					.join("")
			: clean;
	return [
		parseInt(full.slice(0, 2), 16),
		parseInt(full.slice(2, 4), 16),
		parseInt(full.slice(4, 6), 16),
	];
}
