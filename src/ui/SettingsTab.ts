import { PluginSettingTab, Setting } from "obsidian";
import type ShareQuotePlugin from "../main";
import { STYLE_LABELS, type StyleKey } from "../render/styles";
import { DEFAULT_SETTINGS, parseKeyList } from "../settings";
import { RATIOS, type RatioKey } from "../types";

const EXPORT_SCALES: Record<string, string> = {
	"1": "1× — 1200×1500 at 4:5",
	"2": "2× — larger files, sharper on high-density displays",
	"3": "3× — print-sized",
};

export class ShareQuoteSettingTab extends PluginSettingTab {
	constructor(private host: ShareQuotePlugin) {
		super(host.app, host);
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.host;
		containerEl.empty();

		const save = () => void this.host.saveSettings();

		new Setting(containerEl).setName("Defaults").setHeading();

		new Setting(containerEl)
			.setName("Aspect ratio")
			.setDesc("Which shape the share sheet opens on.")
			.addDropdown((dropdown) => {
				for (const key of Object.keys(RATIOS)) dropdown.addOption(key, key);
				dropdown.setValue(settings.defaultRatio).onChange((value) => {
					settings.defaultRatio = value as RatioKey;
					save();
				});
			});

		new Setting(containerEl)
			.setName("Style")
			.setDesc(
				"Pretty composites the cover art. Clean and Classic are text only, and ignore the cover."
			)
			.addDropdown((dropdown) => {
				for (const [key, label] of Object.entries(STYLE_LABELS)) {
					dropdown.addOption(key, label);
				}
				dropdown.setValue(settings.defaultStyle).onChange((value) => {
					settings.defaultStyle = value as StyleKey;
					save();
				});
			});

		new Setting(containerEl)
			.setName("Use theme fonts")
			.setDesc(
				"Draw with the current Obsidian theme's fonts instead of the style's own. " +
					"Images will look different if you change theme."
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.useThemeFonts).onChange((value) => {
					settings.useThemeFonts = value;
					save();
				})
			);

		new Setting(containerEl).setName("Export").setHeading();

		new Setting(containerEl)
			.setName("Image scale")
			.setDesc("Base sizes are already suitable for social media, so 1× is usually enough.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(EXPORT_SCALES)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(String(settings.exportScale)).onChange((value) => {
					settings.exportScale = Number(value);
					save();
				});
			});

		new Setting(containerEl)
			.setName("Save images to")
			.setDesc("Vault folder for saved images. Leave empty to save at the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Share Quote")
					.setValue(settings.outputFolder)
					.onChange((value) => {
						settings.outputFolder = value.trim();
						save();
					})
			);

		new Setting(containerEl).setName("Frontmatter").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description share-quote-settings-note",
			text:
				"Comma-separated, checked in order — the first key present in a note wins. " +
				"A <cite> line inside the quote takes priority over all of these.",
		});

		this.keyList(
			containerEl,
			"Title keys",
			"Where the work's title comes from.",
			settings.titleKeys,
			(keys) => {
				settings.titleKeys = keys;
				save();
			}
		);

		this.keyList(
			containerEl,
			"Author keys",
			"Where the author's name comes from.",
			settings.authorKeys,
			(keys) => {
				settings.authorKeys = keys;
				save();
			}
		);

		this.keyList(
			containerEl,
			"Cover keys",
			"Where the cover image comes from. Accepts a vault path, a wikilink, or a URL.",
			settings.coverKeys,
			(keys) => {
				settings.coverKeys = keys;
				save();
			}
		);

		new Setting(containerEl)
			.setName("Restore defaults")
			.setDesc("Reset every setting above to its original value.")
			.addButton((button) =>
				button
					.setButtonText("Restore defaults")
					.setWarning()
					.onClick(async () => {
						// A JSON round-trip rather than structuredClone: the settings are
						// plain data, and structuredClone postdates the oldest WebView this
						// plugin claims to support.
						Object.assign(
							this.host.settings,
							JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
						);
						await this.host.saveSettings();
						this.display();
					})
			);
	}

	/** A comma-separated list of frontmatter keys. */
	private keyList(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		value: string[],
		onChange: (keys: string[]) => void
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.addClass("share-quote-key-input");
				text.setValue(value.join(", ")).onChange((raw) => {
					const keys = parseKeyList(raw);
					// An empty field would silently disable detection for this field, so
					// keep the previous list rather than accepting nothing.
					if (keys.length) onChange(keys);
				});
			});
	}
}
