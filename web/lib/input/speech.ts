"use client";

/**
 * Dictation, using the browser's own speech recognition.
 *
 * One honest caveat, which is why the button carries it in its tooltip: unlike
 * the OCR beside it, this is not local. Chrome and Edge stream the audio to
 * their vendor's speech service to transcribe it. Nothing else in this app
 * sends a reader's question anywhere, so the exception is worth naming rather
 * than burying. Firefox has no implementation at all, and `supported()`
 * reports that instead of the button failing silently.
 *
 * The transcript lands in the textarea for the reader to check. It is never
 * sent for them: speech recognition mishears, and this corpus is full of
 * transliterated Arabic it has never been trained on.
 */

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
interface SpeechEvent {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechErrorEvent {
  error: string;
}
interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognizerConstructor = new () => SpeechRecognizer;

function constructor(): RecognizerConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognizerConstructor;
    webkitSpeechRecognition?: RecognizerConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function speechSupported(): boolean {
  return constructor() !== undefined;
}

const MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone access was refused. Allow it in the browser's address bar to dictate.",
  "service-not-allowed":
    "Microphone access was refused. Allow it in the browser's address bar to dictate.",
  "audio-capture": "No microphone found.",
  network: "The speech service could not be reached.",
  aborted: "",
  "no-speech": "",
};

interface Handlers {
  /** Called on every update with the whole transcript so far. */
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

/** Starts listening. Returns a function that stops it. */
export function startDictation(handlers: Handlers): () => void {
  const Recognizer = constructor();
  if (!Recognizer) {
    handlers.onError("This browser has no speech recognition. Chrome or Edge does.");
    handlers.onEnd();
    return () => {};
  }

  const recognizer = new Recognizer();
  recognizer.lang = navigator.language || "en-US";
  recognizer.continuous = true;
  recognizer.interimResults = true;

  let settled = "";

  recognizer.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) settled += text;
      else interim += text;
    }
    const whole = (settled + interim).replace(/\s+/g, " ").trim();
    handlers.onTranscript(whole, interim === "");
  };

  recognizer.onerror = (event) => {
    const message = MESSAGES[event.error];
    // "" means expected and harmless -- a pause in speech, or our own stop().
    if (message !== "") handlers.onError(message ?? `Dictation failed (${event.error}).`);
  };

  recognizer.onend = () => handlers.onEnd();

  try {
    recognizer.start();
  } catch {
    handlers.onError("Dictation could not start.");
    handlers.onEnd();
  }

  return () => recognizer.stop();
}
