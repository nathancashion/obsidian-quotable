/**
 * Dev-only harness server.
 *
 * Serves dev-harness/ and accepts `POST /save/<name>` with a PNG data URL body,
 * writing it to dev-harness/out/<name>.png. That gives a headless way to inspect
 * renderer output at full resolution instead of squinting at scaled screenshots.
 *
 * Not shipped with the plugin.
 */
import { createServer } from "http";
import { readFile, writeFile, mkdir } from "fs/promises";
import { extname, join, normalize } from "path";

const ROOT = new URL("../dev-harness/", import.meta.url).pathname;
const OUT = join(ROOT, "out");
const PORT = Number(process.env.PORT ?? 8931);

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".png": "image/png",
	".json": "application/json",
};

await mkdir(OUT, { recursive: true });

createServer(async (req, res) => {
	try {
		if (req.method === "POST" && req.url?.startsWith("/save/")) {
			const name = decodeURIComponent(req.url.slice("/save/".length)).replace(
				/[^a-zA-Z0-9._-]/g,
				"_"
			);
			const chunks = [];
			for await (const c of req) chunks.push(c);
			const dataUrl = Buffer.concat(chunks).toString("utf8");
			const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
			await writeFile(join(OUT, `${name}.png`), Buffer.from(b64, "base64"));
			res.writeHead(200).end("ok");
			console.log(`[harness] wrote out/${name}.png`);
			return;
		}

		const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
		const path = join(ROOT, rel === "/" ? "index.html" : rel);
		if (!path.startsWith(ROOT)) {
			res.writeHead(403).end("forbidden");
			return;
		}
		const body = await readFile(path);
		res.writeHead(200, {
			"Content-Type": MIME[extname(path)] ?? "application/octet-stream",
			"Cache-Control": "no-store",
		}).end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
}).listen(PORT, () => console.log(`[harness] http://localhost:${PORT}`));
