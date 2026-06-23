import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "extension");
const outputDirectory = resolve(extensionRoot, "dist");

await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [resolve(extensionRoot, "src/popup.ts")],
  outfile: resolve(outputDirectory, "popup.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
});

await Promise.all(
  ["manifest.json", "popup.html", "popup.css", "icon-16.png", "icon-48.png", "icon-128.png"].map((fileName) =>
    copyFile(
      resolve(extensionRoot, "public", fileName),
      resolve(outputDirectory, fileName),
    ),
  ),
);

console.log(`Chrome extension built: ${outputDirectory}`);
