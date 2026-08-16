import {
	PluginSettingTab,
	type SettingDefinition,
	type SettingDefinitionItem,
} from "obsidian";
import type QuotablePlugin from "../main";
import { STYLE_LABELS } from "../render/styles";
import { DEFAULT_SETTINGS, parseKeyList, type QuotableSettings } from "../settings";
import { RATIOS } from "../types";

/**
 * Settings, declared rather than drawn.
 *
 * `getSettingDefinitions` describes the settings and lets Obsidian render them,
 * which is what puts them in the settings search index — a `display()` override
 * builds DOM the search cannot see.
 *
 * Most keys map straight onto `QuotableSettings`, so the inherited accessors would
 * do. Two shapes don't survive the trip and are converted below: the export scale is
 * a number but a dropdown yields strings, and the frontmatter key lists are arrays
 * presented as one comma-separated field.
 */

const EXPORT_SCALES: Record<string, string> = {
	"1": "1× — 1200×1500 at 4:5",
	"2": "2× — larger files, sharper on high-density displays",
	"3": "3× — print-sized",
};

/** Settings stored as string arrays but edited as one comma-separated field. */
const KEY_LISTS = ["titleKeys", "authorKeys", "coverKeys"] as const;
type KeyListName = (typeof KEY_LISTS)[number];

const isKeyList = (key: string): key is KeyListName =>
	(KEY_LISTS as readonly string[]).includes(key);

export class QuotableSettingTab extends PluginSettingTab {
	constructor(private host: QuotablePlugin) {
		super(host.app, host);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "Defaults",
				items: [
					{
						name: "Aspect ratio",
						desc: "Which shape the share sheet opens on.",
						control: {
							type: "dropdown",
							key: "defaultRatio",
							options: Object.fromEntries(Object.keys(RATIOS).map((r) => [r, r])),
						},
					},
					{
						name: "Style",
						desc: "Pretty composites the cover art. Clean and Classic are text only, and ignore the cover.",
						control: { type: "dropdown", key: "defaultStyle", options: STYLE_LABELS },
					},
					{
						name: "Use theme fonts",
						desc: "Draw with the current Obsidian theme's fonts instead of the style's own. Images will look different if you change theme.",
						control: { type: "toggle", key: "useThemeFonts" },
					},
				],
			},
			{
				type: "group",
				heading: "Export",
				items: [
					{
						name: "Image scale",
						desc: "Base sizes are already suitable for social media, so 1× is usually enough.",
						control: { type: "dropdown", key: "exportScale", options: EXPORT_SCALES },
					},
					{
						name: "Vault folder for embeds",
						desc: "Where 'Insert in note' stores its image. Saving to your device uses a system dialog, so this doesn't affect it. Empty means the vault root.",
						control: {
							type: "folder",
							key: "outputFolder",
							placeholder: "Quotable",
							includeRoot: true,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Frontmatter",
				items: [
					this.keyList(
						"Title keys",
						"titleKeys",
						"Where the work's title comes from."
					),
					this.keyList(
						"Author keys",
						"authorKeys",
						"Where the author's name comes from."
					),
					this.keyList(
						"Cover keys",
						"coverKeys",
						"Where the cover image comes from. Accepts a vault path, a wikilink, or a URL."
					),
				],
			},
			{
				name: "Restore defaults",
				desc: "Reset every setting above to its original value.",
				action: () => {
					// Plain data, so a JSON round-trip is enough and avoids depending on
					// structuredClone, which postdates the oldest WebView we support.
					Object.assign(
						this.host.settings,
						JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as QuotableSettings
					);
					void this.host.saveSettings();
					this.update();
				},
			},
		];
	}

	/**
	 * Comma-separated list of frontmatter keys, checked in order.
	 *
	 * Empty input is rejected rather than accepted: blanking the field would switch
	 * off detection for that role with nothing on screen to explain why.
	 */
	private keyList(name: string, key: KeyListName, desc: string): SettingDefinition {
		return {
			name,
			desc: `${desc} Comma-separated, checked in order — the first key present in a note wins. A <cite> line inside the quote takes priority over all of these.`,
			control: {
				type: "text",
				key,
				placeholder: DEFAULT_SETTINGS[key].join(", "),
				validate: (value: string) =>
					parseKeyList(value).length ? undefined : "Enter at least one key.",
			},
		};
	}

	getControlValue(key: string): unknown {
		if (key === "exportScale") return String(this.host.settings.exportScale);
		if (isKeyList(key)) return this.host.settings[key].join(", ");
		return this.host.settings[key as keyof QuotableSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.host.settings;

		if (key === "exportScale") {
			const scale = Number(value);
			settings.exportScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
		} else if (isKeyList(key)) {
			settings[key] = parseKeyList(String(value));
		} else if (key === "outputFolder") {
			settings.outputFolder = String(value).trim();
		} else if (key === "useThemeFonts") {
			settings.useThemeFonts = Boolean(value);
		} else if (key === "defaultRatio" || key === "defaultStyle") {
			// Values come from our own dropdown options, so they are already valid.
			settings[key] = value as never;
		}

		await this.host.saveSettings();
	}
}
