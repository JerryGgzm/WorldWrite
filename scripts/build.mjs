// Deterministic MV3 build without crxjs.
//
// Why not crxjs? Its content-script / service-worker "loader" wraps everything
// in a dynamic `import(chrome.runtime.getURL(...))`, which (a) needs eval-based
// HMR in dev (blocked by strict-CSP sites) and (b) intermittently resolves to
// `chrome-extension://invalid/`. Here we instead emit each entry as a single
// self-contained IIFE bundle (no dynamic import, no eval) and write a plain
// manifest.json. Run: node scripts/build.mjs [--watch]
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rmSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "dist");
const alias = { "@": resolve(root, "src") };
const watch = process.argv.includes("--watch");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const define = { "process.env.NODE_ENV": JSON.stringify("production") };

function baseConfig(extra) {
  return {
    root,
    configFile: false,
    resolve: { alias },
    define,
    build: {
      outDir,
      emptyOutDir: false,
      target: "esnext",
      minify: false,
      watch: watch ? {} : null,
      ...extra.build,
    },
    ...extra.rest,
  };
}

// 1. Single-file IIFE for the content script (no dynamic import, no eval).
function buildContentScript() {
  return build(
    baseConfig({
      build: {
        lib: {
          entry: resolve(root, "src/content/content-script.ts"),
          formats: ["iife"],
          name: "InlineAiContentScript",
          fileName: () => "content-script.js",
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
      rest: {},
    }),
  );
}

// 2. Single-file IIFE for the service worker (classic worker, no module type).
function buildServiceWorker() {
  return build(
    baseConfig({
      build: {
        lib: {
          entry: resolve(root, "src/background/service-worker.ts"),
          formats: ["iife"],
          name: "InlineAiServiceWorker",
          fileName: () => "service-worker.js",
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
      rest: {},
    }),
  );
}

// 3. React options page (normal HTML build; code-splitting here is harmless
//    because it is a regular extension page, not an injected script).
function buildOptions() {
  return build(
    baseConfig({
      build: {
        rollupOptions: {
          input: {
            options: resolve(root, "src/options/index.html"),
            popup: resolve(root, "src/popup/index.html"),
          },
        },
      },
      rest: { base: "./", plugins: [react()] },
    }),
  );
}

function writeManifest() {
  const manifest = {
    manifest_version: 3,
    name: "WorldWrite",
    description:
      "Translate, polish & understand text inline on any site with your own AI key. Preview before replace. Private by default.",
    version: pkg.version,
    icons: {
      16: "icons/icon-16.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_title: "WorldWrite",
      default_popup: "src/popup/index.html",
      default_icon: {
        16: "icons/icon-16.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
    options_page: "src/options/index.html",
    background: {
      // Classic service worker (IIFE) — avoids module/dynamic-import issues.
      service_worker: "service-worker.js",
    },
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["content-script.js"],
        run_at: "document_idle",
        all_frames: true,
        match_about_blank: true,
      },
    ],
    permissions: ["contextMenus", "storage"],
    host_permissions: ["<all_urls>"],
    commands: {
      "polish-selection": {
        suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" },
        description: "Polish the selected text",
      },
      "translate-selection": {
        suggested_key: { default: "Ctrl+Shift+U", mac: "Command+Shift+U" },
        description: "Translate the selected text to your writing language",
      },
      "translate-to-native-selection": {
        description: "Translate the selected text into your native language",
      },
    },
  };
  writeFileSync(
    resolve(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}

function copyIcons() {
  const iconDir = resolve(outDir, "icons");
  mkdirSync(iconDir, { recursive: true });
  for (const size of [16, 48, 128]) {
    copyFileSync(
      resolve(root, `src/assets/icon-${size}.png`),
      resolve(iconDir, `icon-${size}.png`),
    );
  }
}

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyIcons();
  writeManifest();

  // Options build emits HTML/assets; content & SW emit single files.
  await buildOptions();
  await buildContentScript();
  await buildServiceWorker();

  if (watch) {
    console.log("\n[build] watching for changes… reload the extension in Chrome after each rebuild.");
  } else {
    console.log("\n[build] done -> dist/");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
