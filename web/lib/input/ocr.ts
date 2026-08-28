"use client";

import type { Worker } from "tesseract.js";

/**
 * Optical character recognition, in the reader's own tab.
 *
 * Tesseract compiled to WebAssembly. The engine, its language data and the
 * recognition all stay on the reader's machine -- a photographed page never
 * leaves it, which for a site people bring private questions to is the only
 * arrangement worth having. It is also the only one that is free.
 *
 * Assets are served from `public/` (see `scripts/vendorInputAssets.mjs`), not
 * from Tesseract's default CDN.
 */

/** Arabic costs about 20 ms on top of English and makes a photographed
 *  mushaf or hadith page readable, which for this corpus is the case that
 *  matters. Measured on both, output was identical for English-only input. */
const LANGS = ["eng", "ara"];

export type Progress = (label: string, fraction: number | null) => void;

const STAGE_LABELS: Record<string, string> = {
  "loading tesseract core": "starting the reader",
  "initializing tesseract": "starting the reader",
  "loading language traineddata": "loading language data",
  "initializing api": "getting ready",
  "recognizing text": "reading the text",
};

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Set for the duration of a call. The worker's logger is fixed when the
 *  worker is created, but the worker outlives any one call, so progress has
 *  to be routed through a variable rather than captured. */
let activeProgress: Progress | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker(LANGS, 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract",
        langPath: "/tessdata",
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          activeProgress?.(
            STAGE_LABELS[m.status] ?? m.status,
            typeof m.progress === "number" ? m.progress : null,
          );
        },
      });
    })();
    // A failed load must not poison every later attempt.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/**
 * Reads the text out of an image. One at a time: a Tesseract worker handles a
 * single job, and the second caller would otherwise fail rather than wait.
 */
export function ocr(image: Blob, onProgress: Progress): Promise<string> {
  const run = queue.then(async () => {
    activeProgress = onProgress;
    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(image);
      return data.text.replace(/\s+\n/g, "\n").trim();
    } finally {
      activeProgress = null;
    }
  });
  queue = run.catch(() => {});
  return run;
}
