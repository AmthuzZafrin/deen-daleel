/** Shapes shared between the SSE stream and the UI. */

export type SourceKind = "quran" | "hadith" | "tafsir" | "fiqh";

export interface Source {
  chunkId: number;
  canonicalRef: string;
  kind: SourceKind;
  sourceTitle: string;
  permalink: string | null;
  arabicText: string | null;
  englishText: string | null;
  attribution: string | null;
  /**
   * True when the citation names the work and its chapter but not a printed
   * page, because the digitisation carried no page markers there.
   *
   * Several works — Al-Hidaya, Radd al-Muhtar, Al-Ashbah — page badly in every
   * openly licensed version, and no better one exists to substitute. They are
   * included because the alternative is having no Hanafi manual, no usul and no
   * legal maxims at all. But a reader must be able to tell a reference they can
   * check against an edition from one they can only narrow to a chapter, so the
   * distinction is shown rather than smoothed over.
   */
  chapterLevel: boolean;
}

export interface Citation {
  ordinal: number;
  chunkId: number;
  canonicalRef: string;
  citedText: string;
}

export interface Grounding {
  unverified: { text: string; kind: "quran" | "hadith" }[];
  uncited: boolean;
}

/** Provenance shown to the reader: who approved this answer, and when. */
export interface AnswerMeta {
  slug: string;
  question: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  score: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  citations?: Citation[];
  grounding?: Grounding;
  error?: string;
  pending?: boolean;
  /**
   * False when no reviewed answer covered the question. The UI must present
   * those turns as source passages, never as an answer.
   */
  matched?: boolean;
  answer?: AnswerMeta;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export const KIND_LABEL: Record<SourceKind, string> = {
  quran: "Qur'an",
  hadith: "Hadith",
  tafsir: "Tafsir",
  fiqh: "Fiqh",
};
