import { Modal, Plugin } from "obsidian";
import { renderSpikeCard } from "./render/spike";
import {
	canvasToBlob,
	copyImageToClipboard,
	notify,
	probeCapabilities,
	saveBlobToVault,
	shareImageFile,
	type ExportCapabilities,
} from "./export/output";

const RATIOS: Record<string, { w: number; h: number }> = {
	"16:9": { w: 1920, h: 1080 },
	"1:1": { w: 1400, h: 1400 },
	"4:5": { w: 1200, h: 1500 },
	"9:16": { w: 1080, h: 1920 },
};

export default class ShareQuotePlugin extends Plugin {
	capabilities!: ExportCapabilities;

	async onload() {
		this.capabilities = probeCapabilities();
		console.log("[share-quote] capabilities", this.capabilities);

		// --- Phase 0 spike commands (removed once Phase 3 lands a real modal) ---
		this.addCommand({
			id: "spike-render-preview",
			name: "Spike: preview test card",
			callback: () => new SpikeModal(this).open(),
		});

		this.addCommand({
			id: "spike-report-capabilities",
			name: "Spike: report export capabilities",
			callback: () => {
				const c = this.capabilities;
				notify(
					`platform: ${c.platform}\ntoBlob: ${c.canvasToBlob}\n` +
						`clipboard image: ${c.clipboardImage}\nshare files: ${c.shareFiles}`
				);
			},
		});
	}
}

class SpikeModal extends Modal {
	private ratio: keyof typeof RATIOS = "16:9";
	private canvas!: HTMLCanvasElement;

	constructor(private plugin: ShareQuotePlugin) {
		super(plugin.app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("share-quote-modal");
		contentEl.createEl("h3", { text: "Share Quote — Phase 0 spike" });

		this.canvas = contentEl.createEl("canvas", { cls: "share-quote-preview" });

		const ratios = contentEl.createDiv({ cls: "share-quote-row" });
		for (const key of Object.keys(RATIOS)) {
			const btn = ratios.createEl("button", { text: key });
			btn.onclick = () => {
				this.ratio = key as keyof typeof RATIOS;
				ratios.findAll("button").forEach((b) => b.removeClass("is-active"));
				btn.addClass("is-active");
				this.draw();
			};
			if (key === this.ratio) btn.addClass("is-active");
		}

		const actions = contentEl.createDiv({ cls: "share-quote-row" });

		const save = actions.createEl("button", { text: "Save to vault", cls: "mod-cta" });
		save.onclick = async () => {
			const blob = await canvasToBlob(this.canvas);
			const file = await saveBlobToVault(
				this.app,
				blob,
				"Share Quote",
				`spike-${this.ratio.replace(":", "x")}`
			);
			notify(`Saved ${file.path}`);
		};

		if (this.plugin.capabilities.clipboardImage) {
			const copy = actions.createEl("button", { text: "Copy image" });
			copy.onclick = async () => {
				const blob = await canvasToBlob(this.canvas);
				notify((await copyImageToClipboard(blob)) ? "Copied to clipboard" : "Copy failed");
			};
		}

		if (this.plugin.capabilities.shareFiles) {
			const share = actions.createEl("button", { text: "Share…" });
			share.onclick = async () => {
				const blob = await canvasToBlob(this.canvas);
				await shareImageFile(blob, "quote.png");
			};
		}

		this.draw();
	}

	private async draw() {
		// Fonts must be resolved before the first measureText, or the fit will be wrong.
		await document.fonts.ready;
		const { w, h } = RATIOS[this.ratio];
		renderSpikeCard(this.canvas, { width: w, height: h, cover: null });
	}

	onClose() {
		this.contentEl.empty();
	}
}
