import { App, Notice, Platform, TFile, normalizePath } from "obsidian";

/**
 * Everything that turns a rendered canvas into something the user can actually use.
 *
 * The capability surface here differs meaningfully between Electron (desktop) and
 * WKWebView/Android WebView (mobile), so each entry point degrades rather than throws.
 */

export interface ExportCapabilities {
	canvasToBlob: boolean;
	clipboardImage: boolean;
	shareFiles: boolean;
	/** File System Access API — a real "Save as…" dialog rather than a silent download. */
	filePicker: boolean;
	/** Directory equivalent, used to write a whole collection in one prompt. */
	directoryPicker: boolean;
	platform: string;
}

/** Minimal shapes for the File System Access API, absent from the DOM lib we target. */
interface FileSystemWritable {
	write(data: Blob): Promise<void>;
	close(): Promise<void>;
}
interface FileHandleLike {
	createWritable(): Promise<FileSystemWritable>;
}
interface DirectoryHandleLike {
	getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
}
type SaveFilePicker = (options?: {
	suggestedName?: string;
	types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<FileHandleLike>;
type DirectoryPicker = (options?: { mode?: string }) => Promise<DirectoryHandleLike>;

const filePicker = () =>
	(window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
const directoryPicker = () =>
	(window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

/** One image destined for the device. */
export interface OutputFile {
	blob: Blob;
	name: string;
}

/** `cancelled` means the user dismissed a dialog — not an error worth reporting. */
export type SaveOutcome = "saved" | "cancelled";

const isAbort = (err: unknown) => (err as Error)?.name === "AbortError";

/** Probe once at load so the UI can hide actions that cannot work on this device. */
export function probeCapabilities(): ExportCapabilities {
	const clipboardImage =
		typeof ClipboardItem !== "undefined" &&
		typeof navigator !== "undefined" &&
		!!navigator.clipboard?.write;

	// canShare must be called with a real File; a plain object is not enough on iOS.
	let shareFiles = false;
	try {
		const probe = new File([new Uint8Array([0])], "probe.png", { type: "image/png" });
		shareFiles = !!navigator.canShare?.({ files: [probe] }) && !!navigator.share;
	} catch {
		shareFiles = false;
	}

	return {
		canvasToBlob: typeof document.createElement("canvas").toBlob === "function",
		clipboardImage,
		shareFiles,
		filePicker: typeof filePicker() === "function",
		directoryPicker: typeof directoryPicker() === "function",
		platform: Platform.isIosApp
			? "ios"
			: Platform.isAndroidApp
				? "android"
				: Platform.isMacOS
					? "macos"
					: Platform.isWin
						? "windows"
						: "other",
	};
}

export function canvasToBlob(
	canvas: HTMLCanvasElement,
	type = "image/png",
	quality?: number
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
			type,
			quality
		);
	});
}

/** Ensure every folder along `folderPath` exists. Obsidian has no mkdir -p. */
async function ensureFolder(app: App, folderPath: string): Promise<void> {
	if (!folderPath || folderPath === "/") return;
	const parts = normalizePath(folderPath).split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current).catch(() => {
				/* races with sync are fine — the folder exists either way */
			});
		}
	}
}

/** Pick a path that doesn't collide, appending -1, -2, ... as needed. */
function uniquePath(app: App, folder: string, base: string, ext: string): string {
	const dir = folder ? `${normalizePath(folder)}/` : "";
	let candidate = `${dir}${base}.${ext}`;
	let n = 1;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = `${dir}${base}-${n++}.${ext}`;
	}
	return candidate;
}

export async function saveBlobToVault(
	app: App,
	blob: Blob,
	folder: string,
	baseName: string,
	ext = "png"
): Promise<TFile> {
	await ensureFolder(app, folder);
	const path = uniquePath(app, folder, baseName, ext);
	const bytes = await blob.arrayBuffer();
	return app.vault.createBinary(path, bytes);
}

export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
	if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
	try {
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
		return true;
	} catch (err) {
		console.error("[share-quote] clipboard write failed", err);
		return false;
	}
}

/** Native share sheet. Returns false if unavailable or the user dismissed it. */
export async function shareImageFiles(files: OutputFile[]): Promise<boolean> {
	try {
		const payload = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
		if (!navigator.canShare?.({ files: payload }) || !navigator.share) return false;
		await navigator.share({ files: payload });
		return true;
	} catch (err) {
		// AbortError means the user closed the sheet — not a failure worth reporting.
		if (!isAbort(err)) console.error("[share-quote] share failed", err);
		return false;
	}
}

export function shareImageFile(blob: Blob, filename: string): Promise<boolean> {
	return shareImageFiles([{ blob, name: filename }]);
}

/** Last-resort download: lands in the browser's download folder with no prompt. */
function downloadBlob(file: OutputFile): void {
	const url = URL.createObjectURL(file.blob);
	const link = document.body.createEl("a", { href: url, attr: { download: file.name } });
	link.click();
	link.remove();
	// Revoking immediately can cancel the download in some Chromium builds.
	window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Write one image to the device.
 *
 * Prefers a real save dialog. Where the File System Access API is unavailable the
 * file is downloaded instead, which succeeds but gives the user no say in where it
 * lands — hence the capability probe, so the UI can describe the button honestly.
 */
export async function saveFileToDevice(file: OutputFile): Promise<SaveOutcome> {
	const picker = filePicker();
	if (picker) {
		try {
			const handle = await picker({
				suggestedName: file.name,
				types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
			});
			const writable = await handle.createWritable();
			await writable.write(file.blob);
			await writable.close();
			return "saved";
		} catch (err) {
			if (isAbort(err)) return "cancelled";
			console.error("[share-quote] save dialog failed, falling back", err);
		}
	}

	downloadBlob(file);
	return "saved";
}

/**
 * Write several images to the device in one gesture.
 *
 * A directory picker asks once and writes them all. Without it each file downloads
 * separately, which Chromium may throttle or prompt about — acceptable as a fallback,
 * but the reason the picker is preferred.
 */
export async function saveFilesToDevice(files: OutputFile[]): Promise<SaveOutcome> {
	const picker = directoryPicker();
	if (picker) {
		try {
			const directory = await picker({ mode: "readwrite" });
			for (const file of files) {
				const handle = await directory.getFileHandle(file.name, { create: true });
				const writable = await handle.createWritable();
				await writable.write(file.blob);
				await writable.close();
			}
			return "saved";
		} catch (err) {
			if (isAbort(err)) return "cancelled";
			console.error("[share-quote] directory save failed, falling back", err);
		}
	}

	for (const file of files) downloadBlob(file);
	return "saved";
}

export function notify(message: string): void {
	new Notice(message);
}
