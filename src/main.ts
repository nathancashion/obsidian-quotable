import { MarkdownView, Plugin, type Editor, type TFile } from "obsidian";
import { resolveMetadata } from "./capture/metadata";
import { captureFromEditor } from "./capture/selection";
import { notify, probeCapabilities, type ExportCapabilities } from "./export/output";
import { DEFAULT_SETTINGS, type ShareQuoteSettings } from "./settings";
import { ShareModal } from "./ui/ShareModal";

export default class ShareQuotePlugin extends Plugin {
	settings: ShareQuoteSettings = DEFAULT_SETTINGS;
	capabilities!: ExportCapabilities;

	async onload() {
		this.capabilities = probeCapabilities();
		await this.loadSettings();

		this.addCommand({
			id: "share-quote",
			name: "Share quote as image",
			editorCallback: (editor, view) => {
				if (view instanceof MarkdownView) this.share(editor, view.file);
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				if (!(view instanceof MarkdownView) || !view.file) return;
				// Only offer the action when there is actually something to capture.
				if (!captureFromEditor(editor)) return;
				menu.addItem((item) =>
					item
						.setTitle("Share quote as image")
						.setIcon("image")
						.onClick(() => this.share(editor, view.file))
				);
			})
		);

		this.addRibbonIcon("image", "Share quote as image", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				notify("Open a note to share a quote from it");
				return;
			}
			this.share(view.editor, view.file);
		});

		// Useful when diagnosing platform differences, especially on iOS.
		this.addCommand({
			id: "report-capabilities",
			name: "Report export capabilities",
			callback: () => {
				const c = this.capabilities;
				notify(
					`platform: ${c.platform}\ntoBlob: ${c.canvasToBlob}\n` +
						`clipboard image: ${c.clipboardImage}\nshare files: ${c.shareFiles}`
				);
			},
		});
	}

	private share(editor: Editor, file: TFile | null) {
		if (!file) {
			notify("This note has no file on disk");
			return;
		}

		const captured = captureFromEditor(editor);
		if (!captured) {
			notify("Select some text, or put the cursor in a quote block");
			return;
		}

		const source = resolveMetadata(this.app, file, captured, this.settings);

		new ShareModal(
			{
				app: this.app,
				settings: this.settings,
				capabilities: this.capabilities,
				insertEmbed: (path) => editor.replaceSelection(`![[${path}]]\n`),
			},
			source
		).open();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
