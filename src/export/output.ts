import { App, Notice, Platform, TFile, normalizePath } from "obsidian";
import { desktopSave } from "./desktop";
import { createZip } from "./zip";

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
	/** Electron dialog + Node fs available — the path desktop actually uses. */
	nativeSave: boolean;
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
interface PermissionCapable {
	queryPermission?(options: { mode: string }): Promise<string>;
	requestPermission?(options: { mode: string }): Promise<string>;
}
interface DirectoryHandleLike extends PermissionCapable {
	name?: string;
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

/**
 * Outcome of a save.
 *
 * `destination` exists so the notice can state where files actually went. Reporting
 * a bare "saved" is what allowed a silent fallback to look like success.
 */
export interface SaveResult {
	status: "saved" | "cancelled" | "failed";
	destination?: string;
	error?: string;
}

const DOWNLOADS = "your downloads folder";

/**
 * A directory handle can be returned without write access actually being granted,
 * in which case createWritable throws. Ask explicitly rather than finding out
 * halfway through writing a set of files.
 */
async function ensureWritePermission(handle: PermissionCapable): Promise<void> {
	const options = { mode: "readwrite" };
	if (!handle.queryPermission && !handle.requestPermission) return;
	if ((await handle.queryPermission?.(options)) === "granted") return;
	const granted = await handle.requestPermission?.(options);
	if (granted && granted !== "granted") {
		throw new Error("write permission was not granted for that folder");
	}
}

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
		canvasToBlob: typeof createEl("canvas").toBlob === "function",
		clipboardImage,
		shareFiles,
		filePicker: typeof filePicker() === "function",
		directoryPicker: typeof directoryPicker() === "function",
		nativeSave: desktopSave() !== null,
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
	// normalizePath on the whole constructed path, not just the folder: the base name
	// comes from note content and can carry characters that need normalising too.
	let candidate = normalizePath(`${dir}${base}.${ext}`);
	let n = 1;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${dir}${base}-${n++}.${ext}`);
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
		console.error("[quotable] clipboard write failed", err);
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
		if (!isAbort(err)) console.error("[quotable] share failed", err);
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
 * If a save dialog is available it is authoritative: once the user has chosen a
 * destination, a failure is reported rather than quietly redirected somewhere else.
 * The plain download is only for platforms with no dialog at all.
 */
export async function saveFileToDevice(file: OutputFile): Promise<SaveResult> {
	const desktop = desktopSave();
	if (desktop) {
		try {
			const saved = await desktop.saveOne(
				file.name,
				new Uint8Array(await file.blob.arrayBuffer())
			);
			return saved ? { status: "saved", destination: saved } : { status: "cancelled" };
		} catch (err) {
			console.error("[quotable] native save failed", err);
			return { status: "failed", error: (err as Error).message };
		}
	}

	const picker = filePicker();
	if (!picker) {
		downloadBlob(file);
		return { status: "saved", destination: DOWNLOADS };
	}

	let handle: FileHandleLike;
	try {
		handle = await picker({
			suggestedName: file.name,
			types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
		});
	} catch (err) {
		if (isAbort(err)) return { status: "cancelled" };
		console.error("[quotable] save dialog failed", err);
		return { status: "failed", error: (err as Error).message };
	}

	try {
		const writable = await handle.createWritable();
		await writable.write(file.blob);
		await writable.close();
		return { status: "saved", destination: file.name };
	} catch (err) {
		console.error("[quotable] writing the chosen file failed", err);
		return { status: "failed", error: (err as Error).message };
	}
}

/**
 * Write several images to the device in one gesture.
 *
 * With a directory picker the files are written individually into the folder the
 * user chose. Without one they are bundled into a single archive rather than fired
 * off as separate downloads, because a burst of programmatic downloads is blocked
 * by Chromium after the first — silently, from the user's point of view.
 *
 * Crucially, once a folder has been chosen the operation either completes there or
 * reports why not. Falling back to downloads at that point produces the exact
 * failure this replaced: a success message, and no files where the user was looking.
 */
export async function saveFilesToDevice(
	files: OutputFile[],
	archiveName: string
): Promise<SaveResult> {
	const desktop = desktopSave();
	if (desktop) {
		try {
			const entries = await Promise.all(
				files.map(async (file) => ({
					name: file.name,
					data: new Uint8Array(await file.blob.arrayBuffer()),
				}))
			);
			const folder = await desktop.saveMany(entries);
			return folder ? { status: "saved", destination: folder } : { status: "cancelled" };
		} catch (err) {
			console.error("[quotable] native folder save failed", err);
			return { status: "failed", error: (err as Error).message };
		}
	}

	const picker = directoryPicker();

	if (picker) {
		let directory: DirectoryHandleLike;
		try {
			directory = await picker({ mode: "readwrite" });
		} catch (err) {
			if (isAbort(err)) return { status: "cancelled" };
			console.error("[quotable] folder dialog failed", err);
			return { status: "failed", error: (err as Error).message };
		}

		try {
			await ensureWritePermission(directory);
			for (const file of files) {
				const handle = await directory.getFileHandle(file.name, { create: true });
				const writable = await handle.createWritable();
				await writable.write(file.blob);
				await writable.close();
			}
			return { status: "saved", destination: directory.name ?? "the chosen folder" };
		} catch (err) {
			console.error("[quotable] writing to the chosen folder failed", err);
			return { status: "failed", error: (err as Error).message };
		}
	}

	try {
		const entries = await Promise.all(
			files.map(async (file) => ({
				name: file.name,
				data: new Uint8Array(await file.blob.arrayBuffer()),
			}))
		);
		downloadBlob({ blob: createZip(entries), name: `${archiveName}.zip` });
		return { status: "saved", destination: DOWNLOADS };
	} catch (err) {
		console.error("[quotable] building the archive failed", err);
		return { status: "failed", error: (err as Error).message };
	}
}

export function notify(message: string): void {
	new Notice(message);
}
