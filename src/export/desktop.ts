/**
 * Native save paths for Obsidian desktop.
 *
 * The File System Access API (`showSaveFilePicker` / `showDirectoryPicker`) is
 * present in Obsidian's renderer and its dialogs open correctly, but the writes
 * behind them do not land: Electron denies File System Access write permission
 * unless the host application installs a permission handler, and Obsidian does not.
 * The dialog therefore succeeds, `createWritable()` fails, and nothing is written.
 *
 * Desktop instead goes through Electron's own dialog and Node's `fs`, which is the
 * long-established route for Obsidian plugins. Everything here is behind feature
 * detection and returns null when unavailable, so mobile is untouched.
 */

interface ElectronDialog {
	showSaveDialog(options: {
		defaultPath?: string;
		filters?: Array<{ name: string; extensions: string[] }>;
	}): Promise<{ canceled: boolean; filePath?: string }>;
	showOpenDialog(options: {
		properties?: string[];
		defaultPath?: string;
	}): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface NodeFs {
	writeFileSync(path: string, data: Uint8Array): void;
}

interface NodePath {
	join(...parts: string[]): string;
	basename(p: string): string;
}

type Requirer = (id: string) => unknown;

function nodeRequire(): Requirer | null {
	const req = (window as unknown as { require?: Requirer }).require;
	return typeof req === "function" ? req : null;
}

/**
 * `dialog` lives in the main process, so the renderer reaches it through the remote
 * bridge. Obsidian has exposed this under more than one name across versions, hence
 * the sequence of attempts rather than a single lookup.
 */
function electronDialog(): ElectronDialog | null {
	const req = nodeRequire();
	if (!req) return null;

	const candidates: Array<() => unknown> = [
		() => (req("electron") as { remote?: { dialog?: unknown } })?.remote?.dialog,
		() => (req("@electron/remote") as { dialog?: unknown })?.dialog,
		() => (req("electron") as { dialog?: unknown })?.dialog,
	];

	for (const get of candidates) {
		try {
			const dialog = get();
			if (dialog && typeof (dialog as ElectronDialog).showSaveDialog === "function") {
				return dialog as ElectronDialog;
			}
		} catch {
			// Module not present in this build; try the next shape.
		}
	}
	return null;
}

function nodeModules(): { fs: NodeFs; path: NodePath } | null {
	const req = nodeRequire();
	if (!req) return null;
	try {
		const fs = req("fs") as NodeFs;
		const path = req("path") as NodePath;
		if (typeof fs?.writeFileSync === "function" && typeof path?.join === "function") {
			return { fs, path };
		}
	} catch {
		/* not a Node-enabled renderer */
	}
	return null;
}

export interface DesktopSave {
	/** Ask for a destination and write one file. Returns null if the user cancelled. */
	saveOne(defaultName: string, data: Uint8Array): Promise<string | null>;
	/** Ask for a folder and write several files. Returns the folder, or null if cancelled. */
	saveMany(files: Array<{ name: string; data: Uint8Array }>): Promise<string | null>;
}

/** Null when not running on a Node-enabled desktop renderer. */
export function desktopSave(): DesktopSave | null {
	const dialog = electronDialog();
	const modules = nodeModules();
	if (!dialog || !modules) return null;

	const { fs, path } = modules;

	return {
		async saveOne(defaultName, data) {
			const result = await dialog.showSaveDialog({
				defaultPath: defaultName,
				filters: [{ name: "PNG image", extensions: ["png"] }],
			});
			if (result.canceled || !result.filePath) return null;
			fs.writeFileSync(result.filePath, data);
			return path.basename(result.filePath);
		},

		async saveMany(files) {
			const result = await dialog.showOpenDialog({
				properties: ["openDirectory", "createDirectory"],
			});
			const folder = result.filePaths?.[0];
			if (result.canceled || !folder) return null;
			for (const file of files) {
				fs.writeFileSync(path.join(folder, file.name), file.data);
			}
			return path.basename(folder) || folder;
		},
	};
}
