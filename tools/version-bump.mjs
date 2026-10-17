/**
 * Runs from `npm version` (the "version" script) to carry the new package version
 * into manifest.json and versions.json, which the release workflow and Obsidian
 * read. Bumping package.json alone leaves the tag and manifest disagreeing, and the
 * workflow refuses to publish.
 */
import { readFileSync, writeFileSync } from "fs";

const version = process.env.npm_package_version;
if (!version) throw new Error("Run this through `npm version`, not directly.");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
