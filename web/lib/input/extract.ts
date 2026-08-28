"use client";

import { MAX_QUESTION_CHARS } from "@/lib/limits";
import { ocr, type Progress } from "@/lib/input/ocr";

/**
 * Turns an attached file into a question.
 *
 * Every input the composer offers ends in the same place: text in the box,
 * which the reader can read and edit before sending. Nothing is sent on the
 * reader's behalf from something they have not seen -- OCR misreads, and a
 * silently mis-transcribed question would be answered confidently and
 * wrongly.
 *
 * Images go through Tesseract, PDFs through pdf.js, and a PDF with no text
 * layer -- a scan of a printed book, which is most of what exists for this
 * material -- falls back to rendering its first page and reading that.
 */

export const ACCEPT = "image/*,application/pdf,text/plain,.pdf,.txt,.md";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Enough to reach a question; past this the 1,000-character cap bites anyway. */
const MAX_PDF_PAGES = 5;

export class ExtractError extends Error {}

export async function extractText(
  file: File,
  onProgress: Progress,
): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ExtractError(
      `${humanSize(file.size)} is too large — the limit is ${humanSize(MAX_FILE_BYTES)}.`,
    );
  }

  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const isText =
    file.type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md");

  let text: string;
  if (file.type.startsWith("image/")) {
    text = await ocr(file, onProgress);
  } else if (isPdf) {
    text = await pdfText(file, onProgress);
  } else if (isText) {
    onProgress("reading the file", null);
    text = (await file.text()).trim();
  } else {
    throw new ExtractError(
      `Cannot read ${file.type || "that kind of file"}. Attach a photo, a PDF, or a text file.`,
    );
  }

  if (!text) {
    throw new ExtractError(
      "Found no readable text in that. If it is a photo, a straighter and better-lit shot usually helps.",
    );
  }
  return text;
}

/**
 * pdf.js, with the worker served from our own origin.
 *
 * Imported lazily: the library and its worker are over a megabyte, and most
 * readers type their question.
 */
async function pdfText(file: File, onProgress: Progress): Promise<string> {
  onProgress("opening the PDF", null);
  // The `legacy` build, not the default one: the default calls
  // `Map.prototype.getOrInsertComputed`, which no released browser has, and
  // throws the moment a page has to be rasterised -- i.e. on every scan.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    const parts: string[] = [];

    for (let i = 1; i <= pages; i++) {
      onProgress(`reading page ${i} of ${pages}`, i / pages);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      if (parts.join(" ").length > MAX_QUESTION_CHARS * 2) break;
    }

    const text = parts.filter(Boolean).join("\n").trim();
    if (text) return text;

    // No text layer. Almost certainly a scan, so read it as a picture.
    onProgress("no text layer — rendering the page", null);
    const image = await renderFirstPage(doc);
    onProgress("reading the page as an image", null);
    return await ocr(image, onProgress);
  } finally {
    await doc.destroy();
  }
}

type PdfDocument = Awaited<
  ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs").getDocument>["promise"]
>;

async function renderFirstPage(doc: PdfDocument): Promise<Blob> {
  const page = await doc.getPage(1);
  // 2x: Tesseract needs roughly 300 dpi to be reliable, and a PDF point is 72.
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  // `canvas` alone, never alongside `canvasContext`, which pdf.js documents as
  // a contradiction.
  //
  // `intent: "print"` is the load-bearing part. On the default "display"
  // intent pdf.js drives rendering from `requestAnimationFrame`, and a hidden
  // tab never fires one -- so a reader who attaches a scan and switches tab
  // comes back to a composer stuck on "rendering the page" for good. The print
  // path renders straight through instead, which is what rasterising for OCR
  // wants anyway: there is no frame to keep up with.
  //
  // `background` matters too. A PDF page is transparent where nothing is
  // drawn, and flattening that to PNG leaves black glyphs on black, which
  // Tesseract reads as an empty page.
  await page.render({
    canvas,
    viewport,
    intent: "print",
    background: "#ffffff",
  }).promise;
  return toBlob(canvas);
}

export function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new ExtractError("Could not read the image.")),
      "image/png",
    ),
  );
}

function humanSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
