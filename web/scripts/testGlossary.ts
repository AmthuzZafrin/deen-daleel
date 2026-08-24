/**
 * Checks on query glossing. Runs offline — no database, no embedding service.
 *
 *   npx tsx scripts/testGlossary.ts
 *
 * The bug this guards: the curated question set asks about *riba*, *zakat* and
 * *wudu*, while the only English in the corpus is Pickthall's 1930 translation,
 * which says "usury", "the poor-due" and "ablution". Unglossed, "what is riba"
 * returned Qur'an 6:145 and 7:157 — verses about forbidden foods — and none of
 * the four verses on riba, which sit in the corpus perfectly retrievable.
 */

import { glossQuery } from "../lib/rag/glossary";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

console.log("terms are glossed into the translation's wording");

check(
  "riba brings in 'usury'",
  glossQuery("what is riba").includes("usury"),
  glossQuery("what is riba"),
);
check("zakat brings in 'poor-due'", glossQuery("who pays zakat").includes("poor-due"));
check("wudu brings in 'ablution'", glossQuery("how do I do wudu").includes("ablution"));
check(
  "the original term is kept, not replaced",
  glossQuery("what is riba").includes("riba"),
  "the Arabic corpus is most of the library and needs the Arabic term",
);
check(
  "several terms in one question all gloss",
  ["poor-due", "alms"].every((w) => glossQuery("zakat versus sadaqah").includes(w)),
);
check(
  "a repeated term is glossed once",
  glossQuery("zakat on gold and zakat on silver").match(/poor-due/g)?.length === 1,
);

console.log("\nqueries that need nothing are left alone");

for (const q of [
  "what does the Quran say about usury",
  "هل الصيام في رمضان واجب",
  "who was the Prophet's first wife",
  "how do I know Islam is true",
]) {
  check(`unchanged: ${JSON.stringify(q.slice(0, 34))}`, glossQuery(q) === q);
}

console.log("\nthe Arabic layer, which is what reaches the fiqh chapters");

check(
  "a wudu question carries نواقض الوضوء",
  glossQuery("does sleeping break wudu").includes("نواقض الوضوء"),
  glossQuery("does sleeping break wudu"),
);
check(
  "a possessive between verb and noun still matches",
  glossQuery("does getting changed break my wudu").includes("نواقض الوضوء"),
  glossQuery("does getting changed break my wudu"),
);
check(
  "losing count carries سجود السهو",
  glossQuery("I lost count of my rak'ahs").includes("سجود السهو"),
);
check(
  "socks carry المسح على الخفين",
  glossQuery("how long can I wipe over socks").includes("المسح على الخفين"),
);
check(
  "a term in two maps keeps both halves",
  ["poor-due", "الزكاة"].every((w) => glossQuery("who pays zakat").includes(w)),
  "the English reaches Pickthall, the Arabic reaches the fiqh works — " +
    `dropping either halves retrieval. Got: ${glossQuery("who pays zakat")}`,
);

check(
  "english-only drops the Arabic half and keeps the English",
  glossQuery("who pays zakat", "english-only").includes("poor-due") &&
    !/[\u0600-\u06FF]/.test(glossQuery("who pays zakat", "english-only")),
  "measuring the Arabic layer means running the same question without it; " +
    `got: ${glossQuery("who pays zakat", "english-only")}`,
);
check(
  "a question only PRACTICE knows is untouched under english-only",
  glossQuery("can I pray with nail polish on", "english-only") ===
    "can I pray with nail polish on",
  "wudu is in GLOSS as well, so it is a poor probe; nail polish is PRACTICE " +
    "alone and shows the layer really is off",
);

console.log("\nword boundaries");

check(
  "a name containing a term is not glossed",
  glossQuery("Salahuddin was a ruler") === "Salahuddin was a ruler",
);
check(
  "a derived word is not glossed",
  !glossQuery("my zakatable wealth").includes("poor-due"),
);
check(
  "but the bare term beside it still is",
  glossQuery("zakatable wealth above nisab").includes("threshold"),
);
check(
  "case is ignored",
  glossQuery("What is Riba?").includes("usury"),
  glossQuery("What is Riba?"),
);

console.log("\nmodern concepts reach the matter the sources discuss");

check(
  "mortgage reaches lending at increase",
  ["stipulated increase", "usury"].every((w) =>
    glossQuery("can I take out a mortgage").includes(w),
  ),
);
check(
  "insurance reaches gharar",
  glossQuery("is life insurance permissible").includes("gharar"),
);
check("lottery reaches maysir", glossQuery("can I buy a lottery ticket").includes("maysir"));
check(
  "photos reach taswir",
  glossQuery("can I post photos online").includes("taswir"),
);
check(
  "dating reaches khalwa",
  glossQuery("is dating allowed").includes("khalwa"),
);
check(
  "a multi-word concept matches as a unit",
  glossQuery("can I open a savings account").includes("deposit lent at increase"),
);
check(
  "two concepts in one question are kept apart",
  glossQuery("photos on social media").includes("pictures; backbiting"),
  glossQuery("photos on social media"),
);
check(
  "an unrelated modern word is left alone",
  glossQuery("is this a good idea for me") === "is this a good idea for me",
  "both earlier probes here — 'treat my parents' and 'pray on a train' — are " +
    "now covered by the PRACTICE layer, which is the point of it; they were " +
    "replaced rather than the entries removed",
);

console.log(
  failures === 0 ? "\nall glossary checks passed" : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
