import { requestUrl, type App } from "obsidian";
import type { CoverRef } from "./types";

/**
 * Loading cover art into something both the renderer and the palette extractor
 * can use.
 *
 * Both paths deliberately go through a Blob object URL. Drawing an `app://`
 * resource path or a remote URL straight onto a canvas can taint it, which would
 * make `getImageData` (palette extraction) and `toBlob` (export) throw. Reading
 * the bytes ourselves sidesteps that on every platform.
 */

export interface LoadedCover {
	image: HTMLImageElement;
	/** Must be revoked once the image is no longer needed. */
	release: () => void;
}

function imageFromBlob(blob: Blob): Promise<LoadedCover> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(blob);
		const image = new Image();
		image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("cover image failed to decode"));
		};
		image.src = url;
	});
}

export async function loadCover(app: App, ref: CoverRef): Promise<LoadedCover> {
	if (ref.kind === "vault") {
		const file = app.vault.getFileByPath(ref.path);
		if (!file) throw new Error(`cover not found in vault: ${ref.path}`);
		const bytes = await app.vault.readBinary(file);
		return imageFromBlob(new Blob([bytes]));
	}

	// requestUrl bypasses CORS, which plain fetch would fail on for most covers.
	const response = await requestUrl({ url: ref.url });
	return imageFromBlob(new Blob([response.arrayBuffer]));
}
