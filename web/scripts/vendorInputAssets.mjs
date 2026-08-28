/**
 * Vendors the client-side OCR and PDF assets into `public/`.
 *
 * The mic, attach and screenshot buttons all end in the same place: text in
 * the question box. Speech is the browser's own; the other two need Tesseract
 * (image -> text) and pdf.js (PDF -> text), both of which run entirely in the
 * reader's tab. Nothing here calls a paid service, and nothing here reaches a
 * CDN at runtime -- Tesseract would otherwise fetch its core and language data
 * from unpkg on first use, which would put a third party in the request path
 * of a reader's private question and break the app the moment that host is
 * unreachable.
 *
 * pdf.js is taken from its `legacy` build, which carries the core-js
 * polyfills. The default build calls `Map.prototype.getOrInsertComputed`, a
 * proposal no released browser implements yet, and throws on any page it has
 * to rasterise -- which is every scanned PDF, the common case here.
 *
 * ~23 MB of binaries, so `public/tesseract` and `public/tessdata` are
 * git-ignored and rebuilt here instead. Runs on `postinstall`; re-run by hand
 * with `npm run vendor:input`.
 */

import { createWriteStream } from "node:fs";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const pub = join(web, "public");
const modules = join(web, "node_modules");

/** Only the LSTM cores are reachable: `legacyCore` is never set, and the
 *  `_fast` language data below is LSTM-only. Shipping the other nine files
 *  would double the directory for code no browser will ask for. */
const CORE_KEEP = /-lstm\.(js|wasm|wasm\.js)$/;

const LANGS = ["eng", "ara"];
const TESSDATA = "https://tessdata.projectnaptha.com/4.0.0_fast";

async function exists(p) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function vendorTesseract() {
  const dest = join(pub, "tesseract");
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  await cp(
    join(modules, "tesseract.js/dist/worker.min.js"),
    join(dest, "worker.min.js"),
  );
  await cp(join(modules, "tesseract.js-core"), dest, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(join(modules, "tesseract.js-core").length + 1);
      return rel === "" || !rel.includes(".") || CORE_KEEP.test(rel);
    },
  });
  console.log("vendored tesseract worker + LSTM cores");
}

async function vendorLangs() {
  const dest = join(pub, "tessdata");
  await mkdir(dest, { recursive: true });
  for (const lang of LANGS) {
    const file = join(dest, `${lang}.traineddata.gz`);
    if (await exists(file)) {
      console.log(`${lang}.traineddata.gz already present`);
      continue;
    }
    const resp = await fetch(`${TESSDATA}/${lang}.traineddata.gz`);
    if (!resp.ok) {
      throw new Error(`${lang}.traineddata.gz: HTTP ${resp.status}`);
    }
    await pipeline(resp.body, createWriteStream(file));
    console.log(`downloaded ${lang}.traineddata.gz`);
  }
}

async function vendorPdfWorker() {
  await cp(
    join(modules, "pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
    join(pub, "pdf.worker.min.mjs"),
  );
  console.log("vendored pdf.js worker");
}

await mkdir(pub, { recursive: true });
await vendorTesseract();
await vendorLangs();
await vendorPdfWorker();
