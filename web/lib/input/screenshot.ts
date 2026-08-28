"use client";

import { ExtractError, toBlob } from "@/lib/input/extract";

/**
 * Captures one frame of a window or screen the reader picks.
 *
 * The browser's own picker decides what is shared and shows it plainly, so
 * this cannot take a picture of anything the reader did not choose. The frame
 * is drawn to a canvas, read by the local OCR, and discarded -- it is never
 * uploaded.
 *
 * Needs a secure context. That is localhost in development and the tunnel's
 * HTTPS in the deployed case, so both work; plain HTTP over a LAN address
 * would not, and says so.
 */
export async function captureScreen(): Promise<Blob> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new ExtractError(
      "This browser cannot capture the screen. Chrome, Edge or Firefox on a desktop can.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (err) {
    // Cancelling the picker is a decision, not a failure.
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      throw new ExtractError("");
    }
    throw new ExtractError("The screen could not be captured.");
  }

  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    // The first frame after play() can still be blank; wait for a real one.
    await nextFrame(video);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) {
      throw new ExtractError("The captured frame was empty.");
    }
    const context = canvas.getContext("2d");
    if (!context) throw new ExtractError("This browser cannot read the frame.");
    context.drawImage(video, 0, 0);

    video.pause();
    video.srcObject = null;
    return await toBlob(canvas);
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

function nextFrame(video: HTMLVideoElement): Promise<void> {
  const withCallback = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  if (withCallback.requestVideoFrameCallback) {
    return new Promise((resolve) =>
      withCallback.requestVideoFrameCallback!(() => resolve()),
    );
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
