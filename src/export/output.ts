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
	platform: string;
}

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
export async function shareImageFile(blob: Blob, filename: string): Promise<boolean> {
	try {
		const file = new File([blob], filename, { type: blob.type });
		if (!navigator.canShare?.({ files: [file] }) || !navigator.share) return false;
		await navigator.share({ files: [file] });
		return true;
	} catch (err) {
		// AbortError means the user closed the sheet — not a failure worth reporting.
		if ((err as Error)?.name !== "AbortError") {
			console.error("[share-quote] share failed", err);
		}
		return false;
	}
}

export function notify(message: string): void {
	new Notice(message);
}
