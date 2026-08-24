/**
 * Assert the TypeScript and Python Arabic normalisers agree.
 *
 * The corpus is normalised by ingest/normalize_ar.py; queries are normalised by
 * lib/rag/normalizeAr.ts. Divergence between them does not throw — it just makes
 * Arabic search quietly return nothing. This script turns that silent failure
 * into a loud one.
 *
 *   npx tsx scripts/checkNormalizerParity.ts
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { normalizeArabic, normalizeQuery } from "../lib/rag/normalizeAr";

const INGEST = path.resolve(process.cwd(), "..", "ingest");
const PY = existsSync(path.join(INGEST, ".venv/bin/python"))
  ? path.join(INGEST, ".venv/bin/python")
  : "python3";

const CASES = [
  "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
  "ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلْحَىُّ ٱلْقَيُّومُ",
  "وَإِذَا ضَرَبْتُمْ فِى ٱلْأَرْضِ",
  "الصَّلَاةُ عَلَى مُوسَى",
  "مُؤْمِن سَئِمَ",
  "آ أ إ ٱ ا",
  "الحـــمد لله",
  "رقم ١٢٣٤",
  "رقم ۱۲۳۴",
  "الْحَمْدُ لِلَّهِ ۝",
  "﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾",
  "  الحمد    لله  ",
  "",
  "what does الصلاة mean",
  "is it permissible to combine prayers",
];

function pythonNormalize(values: string[]): string[] {
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(INGEST)})
from normalize_ar import normalize_arabic, normalize_query
cases = json.loads(sys.stdin.read())
print(json.dumps({
    "arabic": [normalize_arabic(c) for c in cases],
    "query":  [normalize_query(c)  for c in cases],
}, ensure_ascii=False))
`;
  const out = execFileSync(PY, ["-c", script], {
    input: JSON.stringify(values),
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

const py = pythonNormalize(CASES) as unknown as {
  arabic: string[];
  query: string[];
};

let failures = 0;
const show = (s: string) => (s === "" ? "(empty)" : s);

for (const [i, input] of CASES.entries()) {
  for (const [label, tsFn, expected] of [
    ["normalizeArabic", normalizeArabic, py.arabic[i]],
    ["normalizeQuery", normalizeQuery, py.query[i]],
  ] as const) {
    const actual = tsFn(input);
    if (actual !== expected) {
      failures++;
      console.error(`MISMATCH  ${label}(${JSON.stringify(input)})`);
      console.error(`  python: ${show(expected)}`);
      console.error(`  ts    : ${show(actual)}`);
    }
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} mismatch(es). The corpus and queries will not agree — ` +
      `Arabic lexical search would silently return nothing.`,
  );
  process.exit(1);
}

console.log(
  `normaliser parity OK — ${CASES.length} cases x 2 functions agree across Python and TypeScript`,
);
