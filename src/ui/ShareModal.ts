import { Modal, Platform, Setting, type App } from "obsidian";
import { palettesFromCover } from "../color/palette";
import { loadCover, type LoadedCover } from "../cover";
import { renderCard, type CoverImage } from "../render/canvas";
import { DARK_PALETTE, LIGHT_PALETTE, STYLE_LABELS, type Palette, type StyleKey } from "../render/styles";
import type { QuotableSettings } from "../settings";
import { RATIOS, type QuoteSource, type RatioKey } from "../types";
import {
	canvasToBlob,
	copyImageToClipboard,
	notify,
	saveBlobToVault,
	saveFileToDevice,
	saveFilesToDevice,
	shareImageFiles,
	type ExportCapabilities,
	type OutputFile,
	type SaveResult,
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
	settings: QuotableSettings;
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
		modalEl.addClass("quotable-modal");
		contentEl.empty();

		contentEl.createEl("h3", { text: "Create image", cls: "quotable-heading" });

		this.canvas = contentEl.createEl("canvas", { cls: "quotable-preview" });

		this.buildRatioRow(contentEl);
		this.buildStyleRow(contentEl);
		this.swatchRow = contentEl.createDiv({ cls: "quotable-swatches" });
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
		const row = parent.createDiv({ cls: "quotable-row quotable-ratios" });
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
		const row = parent.createDiv({ cls: "quotable-row quotable-styles" });
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
			const swatch = this.swatchRow.createEl("button", { cls: "quotable-swatch" });
			// The colour is data, so it has to come from JS — but it is passed as a
			// custom property so the styling itself stays in the stylesheet.
			swatch.style.setProperty("--quotable-swatch", palette.from);
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
		const details = parent.createEl("details", { cls: "quotable-details" });
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

	/**
	 * On mobile the save path *is* the share sheet — a WebView cannot write to the
	 * photo library directly, and the sheet's "Save Image" is how a user gets there.
	 * A separate Share button would then open the identical sheet, so it is dropped.
	 */
	private get savesViaShareSheet(): boolean {
		return Platform.isMobile && this.deps.capabilities.shareFiles;
	}

	private buildActions(parent: HTMLElement) {
		const row = parent.createDiv({ cls: "quotable-row quotable-actions" });
		const { capabilities } = this.deps;

		const saveLabel = Platform.isIosApp
			? "Save to Photos"
			: this.savesViaShareSheet
				? "Save image"
				: // The ellipsis promises a dialog, so only use it when there will be one.
					capabilities.filePicker
					? "Save image…"
					: "Save image";

		const save = row.createEl("button", { text: saveLabel, cls: "mod-cta" });
		save.onclick = () => void this.withExport(async () => {
			const file = await this.outputFor(this.ratio);
			if (this.savesViaShareSheet) {
				await shareImageFiles([file]);
				return;
			}
			this.report(await saveFileToDevice(file), `Saved ${file.name}`);
		});

		const collection = row.createEl("button", { text: "Save collection" });
		collection.setAttribute(
			"aria-label",
			"Save every aspect ratio: 16:9, 1:1, 4:5 and 9:16"
		);
		collection.onclick = () => void this.withExport(async () => {
			const files: OutputFile[] = [];
			for (const ratio of Object.keys(RATIOS) as RatioKey[]) {
				files.push(await this.outputFor(ratio));
			}
			if (this.savesViaShareSheet) {
				await shareImageFiles(files);
				return;
			}
			this.report(
				await saveFilesToDevice(files, this.baseName()),
				`Saved ${files.length} images`
			);
		});

		if (capabilities.shareFiles && !this.savesViaShareSheet) {
			const share = row.createEl("button", { text: "Share…" });
			share.onclick = () => void this.withExport(async () => {
				await shareImageFiles([await this.outputFor(this.ratio)]);
			});
		}

		if (capabilities.clipboardImage) {
			const copy = row.createEl("button", { text: "Copy image" });
			copy.onclick = () => void this.withExport(async () => {
				const { blob } = await this.outputFor(this.ratio);
				notify(
					(await copyImageToClipboard(blob))
						? "Image copied to clipboard"
						: "Could not copy image"
				);
			});
		}

		if (this.deps.insertEmbed) {
			const insert = row.createEl("button", { text: "Insert in note" });
			insert.onclick = () => void this.withExport(async () => {
				const { blob } = await this.outputFor(this.ratio);
				const file = await saveBlobToVault(
					this.app,
					blob,
					this.deps.settings.outputFolder,
					`${this.baseName()} ${this.ratio.replace(":", "x")}`
				);
				this.deps.insertEmbed?.(file.path);
				notify(`Inserted ${file.name}`);
				this.close();
			});
		}
	}

	/**
	 * Turn a save result into a notice. The destination is always named: a message
	 * that just says "saved" cannot distinguish success from a file written
	 * somewhere the user was not looking.
	 */
	private report(result: SaveResult, success: string) {
		if (result.status === "cancelled") return;
		if (result.status === "failed") {
			notify(`Could not save: ${result.error ?? "unknown error"}`);
			return;
		}
		notify(result.destination ? `${success} to ${result.destination}` : success);
	}

	/** Render one ratio at export scale, ready to write out. */
	private async outputFor(ratio: RatioKey): Promise<OutputFile> {
		const offscreen = createEl("canvas");
		renderCard(offscreen, {
			source: this.source,
			ratio,
			style: this.style,
			palette: this.palettes[this.paletteIndex],
			cover: this.cover?.image,
			scale: this.deps.settings.exportScale,
			fonts: this.deps.fonts,
		});
		return {
			blob: await canvasToBlob(offscreen),
			name: `${this.baseName()} ${ratio.replace(":", "x")}.png`,
		};
	}

	/** Run an export action, surfacing any failure rather than dropping it. */
	private async withExport(run: () => Promise<void>) {
		try {
			await run();
		} catch (err) {
			console.error("[quotable] export failed", err);
			notify(`Export failed: ${(err as Error).message}`);
		}
	}

	// --- rendering ---

	/** Filename stem, without ratio suffix or extension. */
	private baseName(): string {
		const stem = (this.source.title || this.source.quote)
			.slice(0, 48)
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.trim();
		return stem || "quote";
	}

	private async draw() {
		// Web fonts must be resolved before the first measureText or the fit is wrong.
		await document.fonts.ready;
		renderCard(this.canvas, {
			source: this.source,
			ratio: this.ratio,
			style: this.style,
			palette: this.palettes[this.paletteIndex],
			cover: this.cover?.image,
			scale: PREVIEW_SCALE,
			fonts: this.deps.fonts,
		});
	}

	private async loadCoverArt() {
		if (!this.source.cover) return;
		try {
			this.cover = await loadCover(this.app, this.source.cover);
			this.palettes = palettesFromCover(this.cover.image);
			this.paletteIndex = 0;
			this.renderSwatches();
			await this.draw();
		} catch (err) {
			// A missing or unreachable cover is common and not worth a modal error;
			// the neutral palettes already on screen remain usable.
			console.warn("[quotable] cover unavailable", err);
			notify("Cover art could not be loaded — using neutral colours");
		}
	}
}

/** True when the platform can offer a native share sheet. */
export function prefersShareSheet(): boolean {
	return Platform.isMobile;
}
