import { Modal, Platform, Setting, type App } from "obsidian";
import { palettesFromCover } from "../color/palette";
import { loadCover, type LoadedCover } from "../cover";
import { renderCard, type CoverImage } from "../render/canvas";
import { DARK_PALETTE, LIGHT_PALETTE, STYLE_LABELS, type Palette, type StyleKey } from "../render/styles";
import type { ShareQuoteSettings } from "../settings";
import { RATIOS, type QuoteSource, type RatioKey } from "../types";
import {
	canvasToBlob,
	copyImageToClipboard,
	notify,
	saveBlobToVault,
	shareImageFile,
	type ExportCapabilities,
} from "../export/output";

/**
 * The share sheet: preview on top, ratio/style/color pickers below, actions at the
 * bottom. The preview is the same `renderCard` call as the export, only at a lower
 * scale, so there is nothing to keep in sync.
 */

/** Preview resolution as a fraction of export size. Keeps re-renders instant. */
const PREVIEW_SCALE = 0.5;

export interface ShareModalDeps {
	app: App;
	settings: ShareQuoteSettings;
	capabilities: ExportCapabilities;
	/** Font stacks overriding the style's own, when theme fonts are enabled. */
	fonts?: { quote?: string; meta?: string };
	/** Insert an embed for a saved image at the cursor, if an editor is available. */
	insertEmbed?: (linkText: string) => void;
}

export class ShareModal extends Modal {
	private source: QuoteSource;
	private ratio: RatioKey;
	private style: StyleKey;
	private palettes: Palette[] = [LIGHT_PALETTE, DARK_PALETTE];
	private paletteIndex = 0;
	private cover: LoadedCover | null = null;

	private canvas!: HTMLCanvasElement;
	private swatchRow!: HTMLElement;

	constructor(
		private deps: ShareModalDeps,
		source: QuoteSource
	) {
		super(deps.app);
		this.source = { ...source };
		this.ratio = deps.settings.defaultRatio;
		this.style = deps.settings.defaultStyle;
	}

	async onOpen() {
		const { contentEl, modalEl } = this;
		modalEl.addClass("share-quote-modal");
		contentEl.empty();

		contentEl.createEl("h3", { text: "Share quote", cls: "share-quote-heading" });

		this.canvas = contentEl.createEl("canvas", { cls: "share-quote-preview" });

		this.buildRatioRow(contentEl);
		this.buildStyleRow(contentEl);
		this.swatchRow = contentEl.createDiv({ cls: "share-quote-swatches" });
		this.buildActions(contentEl);
		this.buildDetails(contentEl);

		// Draw immediately with neutral palettes so the modal never appears empty,
		// then upgrade once the cover has loaded.
		this.renderSwatches();
		await this.draw();
		await this.loadCoverArt();
	}

	onClose() {
		this.cover?.release();
		this.cover = null;
		this.contentEl.empty();
	}

	// --- controls ---

	private buildRatioRow(parent: HTMLElement) {
		const row = parent.createDiv({ cls: "share-quote-row share-quote-ratios" });
		for (const key of Object.keys(RATIOS) as RatioKey[]) {
			const btn = row.createEl("button", { text: key });
			btn.toggleClass("is-active", key === this.ratio);
			btn.onclick = () => {
				this.ratio = key;
				row.findAll("button").forEach((b) => b.toggleClass("is-active", b === btn));
				void this.draw();
			};
		}
	}

	private buildStyleRow(parent: HTMLElement) {
		const row = parent.createDiv({ cls: "share-quote-row share-quote-styles" });
		for (const key of Object.keys(STYLE_LABELS) as StyleKey[]) {
			const btn = row.createEl("button", { text: STYLE_LABELS[key] });
			btn.toggleClass("is-active", key === this.style);
			btn.onclick = () => {
				this.style = key;
				row.findAll("button").forEach((b) => b.toggleClass("is-active", b === btn));
				void this.draw();
			};
		}
	}

	private renderSwatches() {
		this.swatchRow.empty();
		this.palettes.forEach((palette, index) => {
			const swatch = this.swatchRow.createEl("button", { cls: "share-quote-swatch" });
			swatch.style.background = palette.from;
			swatch.setAttribute("aria-label", palette.id);
			swatch.toggleClass("is-active", index === this.paletteIndex);
			swatch.onclick = () => {
				this.paletteIndex = index;
				this.swatchRow
					.findAll("button")
					.forEach((b) => b.toggleClass("is-active", b === swatch));
				void this.draw();
			};
		});
	}

	private buildDetails(parent: HTMLElement) {
		const details = parent.createEl("details", { cls: "share-quote-details" });
		details.createEl("summary", { text: "Edit attribution" });

		new Setting(details).setName("Title").addText((text) =>
			text.setValue(this.source.title ?? "").onChange((value) => {
				this.source.title = value;
				void this.draw();
			})
		);

		new Setting(details).setName("Author").addText((text) =>
			text.setValue(this.source.author ?? "").onChange((value) => {
				this.source.author = value;
				void this.draw();
			})
		);
	}

	// --- actions ---

	private buildActions(parent: HTMLElement) {
		const row = parent.createDiv({ cls: "share-quote-row share-quote-actions" });

		const save = row.createEl("button", { text: "Save image", cls: "mod-cta" });
		save.onclick = () => void this.withExport(async (blob) => {
			const file = await saveBlobToVault(
				this.app,
				blob,
				this.deps.settings.outputFolder,
				this.baseName()
			);
			notify(`Saved ${file.path}`);
		});

		if (this.deps.capabilities.shareFiles) {
			const share = row.createEl("button", { text: "Share…" });
			share.onclick = () => void this.withExport(async (blob) => {
				await shareImageFile(blob, `${this.baseName()}.png`);
			});
		}

		if (this.deps.capabilities.clipboardImage) {
			const copy = row.createEl("button", { text: "Copy image" });
			copy.onclick = () => void this.withExport(async (blob) => {
				notify(
					(await copyImageToClipboard(blob))
						? "Image copied to clipboard"
						: "Could not copy image"
				);
			});
		}

		if (this.deps.insertEmbed) {
			const insert = row.createEl("button", { text: "Insert in note" });
			insert.onclick = () => void this.withExport(async (blob) => {
				const file = await saveBlobToVault(
					this.app,
					blob,
					this.deps.settings.outputFolder,
					this.baseName()
				);
				this.deps.insertEmbed?.(file.path);
				notify(`Inserted ${file.name}`);
				this.close();
			});
		}

		const copyText = row.createEl("button", { text: "Copy text" });
		copyText.onclick = async () => {
			const parts = [this.source.quote];
			const attribution = [this.source.author, this.source.title]
				.filter((v) => v?.trim())
				.join(", ");
			if (attribution) parts.push(`— ${attribution}`);
			await navigator.clipboard.writeText(parts.join("\n\n"));
			notify("Quote copied");
		};
	}

	/** Render at export scale, hand the blob to `run`, and surface any failure. */
	private async withExport(run: (blob: Blob) => Promise<void>) {
		try {
			const offscreen = document.createElement("canvas");
			renderCard(offscreen, {
				source: this.source,
				ratio: this.ratio,
				style: this.style,
				palette: this.palettes[this.paletteIndex],
				cover: this.cover?.image as CoverImage | undefined,
				scale: this.deps.settings.exportScale,
				fonts: this.deps.fonts,
			});
			await run(await canvasToBlob(offscreen));
		} catch (err) {
			console.error("[share-quote] export failed", err);
			notify(`Export failed: ${(err as Error).message}`);
		}
	}

	// --- rendering ---

	private baseName(): string {
		const stem = (this.source.title || this.source.quote)
			.slice(0, 48)
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.trim();
		return `${stem || "quote"} ${this.ratio.replace(":", "x")}`;
	}

	private async draw() {
		// Web fonts must be resolved before the first measureText or the fit is wrong.
		await document.fonts.ready;
		renderCard(this.canvas, {
			source: this.source,
			ratio: this.ratio,
			style: this.style,
			palette: this.palettes[this.paletteIndex],
			cover: this.cover?.image as CoverImage | undefined,
			scale: PREVIEW_SCALE,
			fonts: this.deps.fonts,
		});
	}

	private async loadCoverArt() {
		if (!this.source.cover) return;
		try {
			this.cover = await loadCover(this.app, this.source.cover);
			this.palettes = palettesFromCover(this.cover.image as CoverImage);
			this.paletteIndex = 0;
			this.renderSwatches();
			await this.draw();
		} catch (err) {
			// A missing or unreachable cover is common and not worth a modal error;
			// the neutral palettes already on screen remain usable.
			console.warn("[share-quote] cover unavailable", err);
			notify("Cover art could not be loaded — using neutral colours");
		}
	}
}

/** True when the platform can offer a native share sheet. */
export function prefersShareSheet(): boolean {
	return Platform.isMobile;
}
