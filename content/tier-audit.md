# Tier audit — what the corpus actually returns

Every tier tag in `questions.yaml` was written by hand before anyone ran a
query. This is the record of checking them against retrieval, and of the
glossary work that checking forced.

Reproduce with:

```bash
cd web
npx tsx scripts/auditTiers.ts   > ../content/tier-audit.tsv    # all 469
npx tsx scripts/measureGloss.ts > ../content/gloss-effect.tsv  # the Arabic layer's effect
```

## What the audit could not measure, and why

Two signals were tried and discarded. They are recorded here so they are not
tried again.

**Absolute rerank score.** An English question scored against Arabic prose runs
an order of magnitude below the same question scored against the English
Qur'an. `what-is-najis` scored 0.0094 and returned Al-Mughni 1:413 and
Al-Fatawa al-Hindiyya 1:46 — both the *kitab al-tahara* chapters, exactly
right. A low score means "the passage is Arabic", not "the passage is wrong".

**Kind mix.** 457 of 469 questions return four or more Qur'an chunks, because
`KIND_FLOOR` in `retrieve.ts` guarantees it. The balancing that stops hadith
being crowded out also makes the mix uninformative. An earlier draft of this
audit claimed a Qur'an-heavy result set was the fingerprint of a miss; it was
measuring the floor.

What does discriminate is the **first** result. A practical fiqh question whose
best hit is a verse or a narrative tafsir, rather than a work of fiqh or hadith,
has usually missed the chapter that answers it. That is a hint for a person, not
a verdict.

One correction to that signal: the two *Ahkam al-Qur'an* and Qurtubi are stored
as tafsir but are works of law — Qurtubi's title is literally "the compendium of
the *rulings* of the Qur'an". Landing on al-Jassas discussing the wudu verse is
a hit, not a fallback. `auditTiers.ts` exempts them.

Relative movement is trustworthy even though the absolute number is not: the
same question, same corpus, scored twice, differs only by what changed between
the runs.

## What the first run found

Not tier errors. A vocabulary gap, at scale.

109 of 469 questions came back topped by scripture. Ten separate wudu questions
— nail polish, contact lenses, a cast, a public bathroom — all returned Qur'an
5:6 or its tafsir. 5:6 is the verse that commands washing. It does not say
whether nail varnish is a barrier; Al-Mabsut and Al-Fatawa al-Hindiyya do, in
Arabic, under a chapter heading the English question never reaches.

The failure has a signature. Four verses top a disproportionate share of the
flagged questions — **2:282, 5:3, 73:20, 2:196** — and they are among the
longest in the Qur'an. A long chunk touching many subjects matches weakly
against almost anything, so a question with no purchase anywhere else lands
there. "Does being depressed mean my faith is weak?" returned 2:282, the verse
on writing down a debt.

## The fix, and its measured effect

A third glossary layer (`PRACTICE` in `web/lib/rag/glossary.ts`) maps how a
reader asks to the Arabic heading of the chapter that answers it —
`نواقض الوضوء` for what breaks wudu, `المسح على الخفين` for wiping over socks,
`القضاء والقدر` for free will. The English half of the query is kept, so the
Qur'an arm still matches as it did.

Measured by running each affected question twice against the same corpus, once
with the layer off and once with it on (`scripts/measureGloss.ts`):

| | before | after |
|---|---|---|
| Median top score, all 469 | 0.0645 | **0.2466** |
| Questions topped by a fiqh work | 250 | **310** |
| Questions topped by a bare verse | 132 | **44** |
| Flagged for review | 109 | **8** |

Tier by tier:

| tier | n | median before | median after | flagged before | after |
|---|---|---|---|---|---|
| A | 354 | 0.0895 | 0.3004 | 86 | 7 |
| B | 84 | 0.0212 | 0.1361 | 23 | 1 |
| C (declines) | 31 | 0.0096 | 0.0157 | 0 | 0 |

The last row is the control that matters. The declines stayed at the floor. The
glossary did not manufacture support for questions the corpus genuinely cannot
answer — which it would have, had it been matching on noise.

The canonical check:

```
"how long can I wipe over socks"
  → Al-Mabsut 1:104        0.9136   three days for a traveller, one for a resident
  → Bada'i al-Sana'i 1:8   0.9004
  → Ahkam al-Qur'an 3:353  0.8496
```

Two entries were added after the first pass caught the layer making things
worse: `hajj` glossed as مناسك alone pulled "do I have to do Hajj, and when?"
away from Quduri's chapter on when it falls due and onto the verse naming the
hajj months, and `zakat` reached the nisab chapters but not the question of
whether a debt is deducted. Both now name the obligation as well as the rite.

## Still flagged — 8

Four are false positives, four are real.

| question | top hit | reading |
|---|---|---|
| `how-to-make-wudu` | Ibn Kathir on 5:6 | correct — that tafsir does describe the washing |
| `backbiting-online` | Qur'an 49:12 | correct — 49:12 *is* the verse on backbiting |
| `keeping-promises` | Qur'an 48:10 | correct enough — fulfilling the covenant |
| `offering-condolences` | Qur'an 3:154 | weak, but the corpus is thin here |
| `family-rejected-me` | Qur'an 71:28 | real miss; pastoral, no fiqh chapter to find |
| `reverting-back-and-forth` | Qur'an 2:209 | real miss; same |
| `muslims-behaving-badly` | Qur'an 4:155 | real miss; same |
| `fasting-long-summer-days` | Qur'an 73:20 | real miss; turns on modern facts, correctly tier B |

The four real misses are all questions where the honest answer is a principle
and a referral, not a ruling. They were downgraded rather than chased.

## Reclassifications applied — 34

Tier tags now reflect what came back, not what was guessed. Every change:

### A → B — the evidence is principle-level at best (7)

| question | score | top hit |
|---|---|---|
| `family-rejected-me` | 0.0125 | Qur'an 71:28 |
| `muslims-behaving-badly` | 0.0437 | Qur'an 4:155 |
| `reverting-back-and-forth` | 0.0471 | Qur'an 2:209 |
| `backbiting-online` | 0.0571 | Qur'an 49:12 |
| `offering-condolences` | 0.0684 | Qur'an 3:154 |
| `keeping-promises` | 0.1122 | Qur'an 48:10 |
| `how-to-make-wudu` | 0.1161 | Tafsir Ibn Kathir 3:49-50 |

`how-to-make-wudu` is the odd one: the corpus covers it exhaustively, but the
top hit is a tafsir rather than the fiqh chapter, so it is drafted with the
extra care tier B implies rather than assumed settled.

### B → A — the sources address these directly (27)

| question | score | top hit |
|---|---|---|
| `women-hajj-without-mahram` | 0.9517 | Al-Majmu' 8:342-344 |
| `tayammum-no-water-at-work` | 0.9380 | Al-Mabsut 1:112 |
| `revert-woman-no-muslim-wali` | 0.8506 | Al-Mughni 7:21 |
| `celebrating-birthdays` | 0.7979 | Majmu' al-Fatawa 25:329-331 |
| `jumuah-at-work` | 0.7622 | Al-Mughni 2:91-92 |
| `writing-a-will` | 0.7422 | Al-Mabsut 27:178 |
| `tayammum-when-ill` | 0.7021 | Al-Mughni 1:170 |
| `non-muslim-parent-died` | 0.6768 | Bada'i al-Sana'i 1:303 |
| `fidyah-when-cannot-fast` | 0.5366 | Al-Mughni 3:38 |
| `black-magic` | 0.5317 | Ahkam al-Qur'an (al-Jassas) 1:61 |
| `zakat-if-i-have-debt` | 0.5044 | Al-Mughni 2:342-343 |
| `injections-and-fasting` | 0.4827 | Majmu' al-Fatawa 25:244-246 |
| `attending-a-non-muslim-funeral` | 0.4819 | Fath al-Bari 3:144 |
| `do-i-have-to-follow-a-madhhab` | 0.4724 | Majmu' al-Fatawa 20:202-204 |
| `praying-on-a-plane` | 0.4460 | Bada'i al-Sana'i 1:109 |
| `irregular-bleeding-istihada` | 0.4412 | Kanz al-Daqa'iq 1:160-165 |
| `do-i-need-a-wali` | 0.4150 | Bada'i al-Sana'i 2:232 |
| `incontinence-and-prayer` | 0.3943 | Kanz al-Daqa'iq 1:160-165 |
| `woman-leading-prayer` | 0.3894 | Kanz al-Daqa'iq 1:160-165 |
| `leaving-islam` | 0.3862 | Al-Fatawa al-Hindiyya 2:253 |
| `blood-test-while-fasting` | 0.3489 | Majmu' al-Fatawa 25:219-221 |
| `fasting-while-pregnant` | 0.3428 | Ahkam al-Qur'an (al-Jassas) 1:226 |
| `birth-control-to-delay-period` | 0.3296 | Majmu' al-Fatawa 22:29-31 |
| `zakat-on-property` | 0.3254 | Al-Mughni 5:372-373 |
| `inhaler-while-fasting` | 0.3130 | Al-Mughni 3:17 |
| `how-much-is-nisab` | 0.3105 | Al-Bahr al-Ra'iq 2:392-393 |
| `cutting-off-toxic-family` | 0.3025 | Al-Minhaj 16:112 |

Note what these have in common. Nearly all are the *modern-circumstance*
questions — an inhaler, a blood test, a plane, no water at work, a revert woman
with no Muslim guardian. They were tagged B on the assumption that a premodern
corpus would not reach them. It does: the fiqh works reason from the same
category (a substance reaching the stomach, the absence of water, the absence
of a guardian), and the reasoning is citable.

### Declines left standing — 6 worth knowing about

These `expect: decline` entries have strong retrieval. They were **not**
reclassified, because they decline for a reason no score can see: the answer
turns on facts about the asker that the app does not have.

| question | score | top hit |
|---|---|---|
| `inheritance-shares` | 0.6650 | Al-Majmu' 16:53 |
| `inheriting-from-non-muslim-parents` | 0.5957 | Al-Majmu' 16:58 |
| `did-my-divorce-count` | 0.5688 | Al-Mughni 7:296-297 |
| `custody-after-divorce` | 0.5615 | Al-Bahr al-Ra'iq 4:342 |
| `fasting-with-a-medical-condition` | 0.5498 | Ahkam al-Qur'an (al-Jassas) 1:265 |
| `medicine-containing-alcohol` | 0.4084 | Al-Fatawa al-Hindiyya 5:414 |

The corpus can state the rule. It cannot know who survived the deceased, what
words were said, or what the medicine is for. The right shape for these is the
rule plus a referral to a person, which is what the decline text should say —
worth re-reading each one to check it explains *what it turns on* rather than
just refusing.

## Where the volume is

Sections by size, with the median top score after the glossary work, and how
many questions still return nothing usable (top score below 0.05).

| section | n | A | B | C | median | weak |
|---|---:|---:|---:|---:|---:|---:|
| 8. Fasting | 38 | 31 | 6 | 1 | 0.3167 | 2 |
| 16. Marriage and relationships | 33 | 23 | 8 | 2 | 0.2810 | 5 |
| 12. Belief and aqidah | 29 | 25 | 1 | 3 | 0.4478 | 6 |
| 17. Money and work | 28 | 7 | 13 | 8 | 0.0080 | 20 |
| 6. Prayer — missed, travel, work | 26 | 21 | 5 | 0 | 0.2917 | 3 |
| 2. Purity — wudu | 25 | 25 | 0 | 0 | 0.2185 | 3 |
| 13. Food and drink | 23 | 12 | 6 | 5 | 0.1466 | 7 |
| 3. Purity — ghusl, tayammum, najasa | 22 | 18 | 4 | 0 | 0.4603 | 2 |
| 1. Brand new / revert-specific | 21 | 19 | 2 | 0 | 0.0839 | 9 |
| 5. Prayer — mechanics | 21 | 21 | 0 | 0 | 0.3342 | 0 |
| 14. Dress and appearance | 21 | 19 | 2 | 0 | 0.1936 | 4 |
| 21. Du'a, dhikr and spiritual life | 20 | 18 | 2 | 0 | 0.1839 | 4 |
| 22. Daily adab and etiquette | 20 | 17 | 2 | 1 | 0.1003 | 6 |
| 9. Zakat and charity | 17 | 11 | 5 | 1 | 0.1987 | 3 |
| 4. Menstruation and women's purity | 16 | 13 | 3 | 0 | 0.5798 | 1 |
| 19. Social life and other religions | 16 | 10 | 6 | 0 | 0.2642 | 4 |
| 18. Technology, media, entertainment | 15 | 9 | 5 | 1 | 0.0670 | 4 |
| 15. Family and non-Muslim relatives | 14 | 9 | 4 | 1 | 0.3372 | 1 |
| 24. Hard questions and doubts | 13 | 10 | 3 | 0 | 0.1906 | 4 |
| 11. Qur'an | 12 | 11 | 1 | 0 | 0.1631 | 2 |
| 20. Death and funerals | 11 | 8 | 1 | 2 | 0.6650 | 1 |
| 23. Health and medicine | 11 | 3 | 2 | 6 | 0.0344 | 7 |
| 10. Hajj and Umrah | 10 | 8 | 2 | 0 | 0.3709 | 1 |
| 7. Jumu'ah | 7 | 6 | 1 | 0 | 0.7222 | 1 |
| **total** | **469** | **374** | **64** | **31** | | |

**Money and work is the outlier and always was.** Median 0.0080 — two orders of
magnitude below every other section — and 20 of its 28 questions return nothing
usable. This is not a vocabulary gap. It is a premodern corpus being asked about
credit cards, pensions, index funds and student loans, and the honest position
is the principle (riba, gharar, the prohibition on selling what you do not
possess) plus a referral. Health and medicine is the same shape at a third the
size.

Purity, prayer, fasting, menstruation, Jumu'ah, death — the sections a new
Muslim needs first — are the strongest in the corpus. That is the right place
to start drafting.

---

## Addendum — what drafting changed

Written after drafting the 21 revert-specific answers, which is the first real
test of whether the audit's tiers survive contact with the work.

**Two tiers went back to A.** `reverting-back-and-forth` and `family-rejected-me`
were downgraded because unaided retrieval topped out on a bare verse. Both turn
out to be answered directly and at length — the first by Sahih Muslim's chapter
*on the acceptance of repentance from sins even when the sins and the repentance
recur*, with al-Nawawi's commentary on it; the second by Qadi 'Iyad on the
degrees of kinship ties, which states the floor as *leaving off shunning, and
connecting by speech even if only with a greeting*. The evidence was there. The
query was not reaching it.

That is the audit's own limit, stated in its own terms: it measures what
retrieval returns, and a tier is a claim about what the corpus contains. Where
the two disagree, drafting is the tiebreaker and drafting wins.

**Nine questions gained `also_retrieve` entries**, each recorded in
`questions.yaml` with the reason. The clearest case: `do-i-have-to-be-circumcised`
returned twelve passages about how an apostate re-enters Islam and not one about
circumcision, because "convert" glosses to إسلام الكافر and crowds out الختان.
Asked in Arabic, the same corpus returns Fath al-Bari and Al-Fatawa al-Hindiyya
on the subject at 0.98. Adding `circumcised` to the glossary did not fix it; the
competing gloss did. `also_retrieve` did.

**Three bugs surfaced that the audit could not have found**, because they only
appear when an answer is actually written:

- `draft.ts commit` verified that every quotation was real but never checked that
  every `[n]` in the prose had a citation behind it, or that every citation was
  referenced. A renumbered answer stored a marker pointing at the wrong daleel
  and the commit passed. Both directions are now checked.
- `checkGrounding` compared source names literally, so a reference that wrapped
  across a line — "in Sahih\nMuslim" — was reported to the reviewer as
  ungrounded. Both sides are now whitespace-flattened.
- The local reranker was running at its 8192-token limit, so a single
  15,000-character chunk in a batch allocated 1.37 GiB and returned a 500. Capped
  at 1024 tokens with an out-of-memory retry that halves the batch.

**One workflow addition**: `scripts/checkQuotes.ts`, which verifies candidate
quotations against their chunks before any prose is written. `commit` already
refuses a bad quotation, but it refuses the whole answer, after the numbering has
settled.

---

## Second addendum — sections 2 and 3

Written while drafting Purity — wudu (25 of 25) and Purity — ghusl, tayammum,
istinja, najasa (22 of 22). Both sections are now complete; with the
revert-specific section that is 77 of 469.

**Fourteen more questions gained `also_retrieve` entries.** The pattern is now clear
enough to state as a rule: *test the Arabic query with `scripts/retrieve.ts`
before spending a prepare cycle on it.* A prepare takes 30–60 seconds and a bad
one costs a full read-and-remap; a retrieval test costs five seconds and tells
you immediately whether the chapter you want is reachable.

Two retargeting rounds were needed and both failed the same way — the query was
phrased as *the words of the ruling* rather than *the words of the chapter*:

- `nail-polish-and-wudu` had `الحائل الذي يمنع وصول الماء إلى البشرة` — an
  accurate description of the concept, which returned Al-Bahr al-Ra'iq on
  washing a beard. Replaced with the worked cases the books actually argue over
  — `العجين والحناء تحت الظفر` — and it returned Al-Fatawa al-Hindiyya 1:4 at
  0.80, which contains the ruling verbatim: **والخضاب إذا تجسد ويبس يمنع تمام
  الوضوء والغسل**.
- The tayammum pair were given the verse text `فلم تجدوا ماء فتيمموا صعيدا طيبا`,
  which returned Tabari on صعيد meaning *barren ground* — the word in its other
  sense. Replaced with the procedural phrasing `التيمم ضربتان...` plus the
  Pickthall English of the same verse, which reaches the Qur'an chunk directly
  at 0.9976. **English works for retrieving the Qur'an**; only the fiqh chapters
  need Arabic.

**A fourth bug, and the most serious of the four.** `draft.ts commit` computed
the grounding result, printed *"Stored anyway, flagged for the reviewer"*, and
then inserted the row without it — the `grounding` column stayed `{}`. `/review`
reads that column. So every hand-drafted answer reached the reviewer with no
flags at all, and the message saying otherwise was false. `generateAnswers.ts`
(the API path) had always persisted it correctly; only the hand path was wrong.
Fixed, and all drafts recommitted. Four now carry flags, all of the same kind: a
hadith collection named *inside* a quotation whose own source is a different
book — Ibn Hajar saying "transmitted by Abu Dawud", al-Nawawi saying "in
Bukhari's narration". Those are worth a reviewer's eye, so the flags are left
standing rather than written around.

**The re-prepare hazard, restated because it bit twice more.** Passage numbers
are positional, so widening a worksheet renumbers everything *and* can evict a
chunk you had already quoted. Both times the eviction was silent at write time
and caught by `commit`. Always re-map chunk → passage after a re-prepare, and
prefer adding an `also_retrieve` entry before drafting rather than after.

**Two further retargets, closing section 3.** `incontinence-and-prayer` and
`shoes-in-prayer-area` had both landed on Kanz al-Daqa'iq's chapter on the
*description* of prayer — the glossed English reached "prayer" and nothing more
specific. Naming the actual chapter subject fixed both: `المستحاضة وصاحب السلس
يتوضأ لكل صلاة` returns Al-Tamhid 16:98-101 and Al-Mughni 1:206, the *ahl
al-a'dhar* chapters, at 0.99; `الصلاة في النعلين ونزع النعل في المسجد` returns
Al-Majmu' 3:156 and Al-Bahr al-Ra'iq 2:61.

**A note on where the corpus genuinely stops.** `is-alcohol-in-perfume-najis` is
the first question in these three sections where no source addresses the subject
at all — perfume alcohol did not exist. The answer is built from the definition
of khamr, the vinegar case, and Ibn Taymiyya's two-thirds rule, and it says so in
its own text. That is the honest shape for this class of question, and Money and
work will be full of it.

---

## Third addendum — a failure mode `commit` does not catch

Found while drafting Prayer — mechanics, and it is the most important thing in
this file for whoever reviews.

`draft.ts commit` verifies that every quotation is **really present in the chunk
it claims**. It does not — and cannot — verify that the quotation **says what the
English sentence attached to it claims**. Those are different properties, and I
produced four failures of the second kind in one session:

- `sujud-al-sahw` attached the Abu Sa'id hadith on doubt ("if he prayed five...")
  to a quote about the Hanafi position on timing. The hadith was not in that
  worksheet at all.
- `crying-in-prayer` attached al-Kasani's *reasoning* to his *evidence*, twice.
- `tayammum-no-water-at-work` attributed a Shafi'i ruling to a quote stating the
  Maliki one.

All four passed `commit`. All four were caught by re-reading, not by a tool.

**The one automated signal that works** is a duplicate: the same `cited_text`
serving two different `[n]` markers in one answer. That is the fingerprint of
reaching for a citation and grabbing whatever was to hand. It found
`tayammum-no-water-at-work` immediately:

```sql
select a.slug, c.cited_text, count(*)
  from answers a join answer_citations c on c.answer_id = a.id
 group by a.slug, c.cited_text having count(*) > 1;
```

That check is now clean across all drafts. But it only catches the duplicate case.
A mismatch using a *different* real quote from the *right* chunk is invisible to
every check in the pipeline.

**So this is the reviewer's job, and it is the job.** At `/review`, read the
Arabic beside the English sentence it is attached to and ask whether the Arabic
actually says that. Everything else — the quote being real, the reference
resolving, the markers being balanced — is already machine-verified. This is not.

---

## Fourth addendum — sections 6 and 7 (nafl prayers, Jumu'ah)

Two things worth carrying forward.

### Query the hadith's own wording, not the topic's name

`salat-al-tawbah` prepared cleanly at 0.97+ on `صلاة التوبة وركعتان يستغفر الله
بعدهما` — and the worksheet did **not** contain the hadith the entire ruling rests
on. The corpus has it, at Sunan Ibn Majah 1:446-448 and again inside Tabari's
tafsir of Al Imran 135. It was simply not what "the prayer of repentance" as a
*phrase* retrieves, because the sources do not call it that. They report an act:
a man sins, makes wudu, prays two rak'ahs, asks forgiveness.

Querying that act verbatim — `ما من عبد يذنب ذنبا فيتوضأ ويصلي ركعتين ثم يستغفر
الله إلا غفر له` — returned it at 0.9971.

**The lesson generalises past this question.** A high rerank score on a
topic-name query means the retrieval found the *chapter*, not that it found the
*evidence*. Where an answer is going to hang on one specific hadith, retrieve that
hadith by its own words as a second `also_retrieve` line. This is cheap — one
five-second `retrieve.ts` call — and it is the difference between an answer built
on the ruling and an answer built on the report the ruling comes from.

Related and already known: a re-prepare renumbers passages positionally. Adding
the query here grew the worksheet from 16 to 23 passages and moved everything.
Re-map before writing.

### The absence pattern, second instance

`jumuah-at-work` is the second question (after `is-alcohol-in-perfume-najis`)
where the corpus does not address the subject, because the subject did not exist.
The jurists reasoned about illness, fear, rain, and mud. Salaried employment is
not on the list, and the nearest structural case in the books — a person whose
time is owned by another — is slavery, which is not what a job is.

What made the answer possible was finding the *principle* rather than the ruling.
Al-Majmu' 4:384 states that the category of excuses is open:

> ان باب الاعذار في ترك الجمعة والجماعة ليس مخصوصا بل كل ما لحق به مشقة شديدة فهو عذر

That is a jurist saying, in his own words, that the list is not the rule — hardship
is the rule. An answer can stand on that honestly, provided it says out loud that
applying it to a modern job is a judgement and not a citation. The answer does say
so, in its own text.

**Expect this shape to dominate Money and work (28) and Health and medicine (11).**
The drafting move is: find the principle, quote the principle, name the gap, and
hand the application back to the reader and their scholar. Do not stretch a ruling
about a named case to cover an unnamed one.

### On the grounding flags

Eight drafts now carry `unverified` entries. Every one is the same benign shape: a
collection named in the English prose (`Bukhari`, `Abu Dawud`, `Tirmidhi`) where
the citation behind it resolves to a different book — either because the
collection is named *inside* the Arabic quotation (al-Nawawi writing "Bukhari
narrated it"), or because the prose says "Abu Dawud" where the citation reads
"Sunan Abi Dawud" and the matcher does not equate them. None has been written
around. They are left standing so the reviewer sees them and can confirm the
pattern rather than trust a claim that it was handled.

---

## Fifth addendum — section 4 (menstruation and women's purity)

The section with the highest ratio of *real disagreement* to settled ruling so far,
and the one where getting the register right matters most.

### Where the schools genuinely split

Three of the sixteen turn on live disputes that a reader will meet in practice, and
the answers report both sides rather than picking:

| Question | The split |
|---|---|
| `quran-on-period` | Majority forbid reciting; Malik and Ibn Taymiyya permit |
| `mosque-on-period` | Shafi'i/Hanbali allow passing through; Hanafi/Maliki neither; a third view has no prohibition |
| `intimacy-during-period` | Above the izar only (Hanafi/Maliki/Shafi'i) vs everything short of intercourse (Hanbali) |

In each case both positions are named jurists on stated evidence, and the answer
says so. A reader who is told only the majority view and then meets the other one
in a lecture has been badly served.

### The evidence weakened by its own collector

`quran-on-period` rests, on the majority side, on Ibn Umar's hadith — and
al-Tirmidhi, who transmits it, flags in the same entry that he knows it only through
Isma'il ibn Ayyash, then quotes al-Bukhari saying that narrator's Hijazi and Iraqi
transmissions are *munkar*. The chain here runs through Nafi', a Medinan.

That is daleel in the strict sense: the reader can check the grading against the
text that carries the ruling. It is also the strongest argument for why the
dissenting view is not fringe, and it would have been dishonest to quote the hadith
without it. **Where a collector grades his own narration, quote the grading.**

### Where the sources have to be read against a cultural practice

Three answers correct a widespread practice that the books do not support:

- **`bleeding-after-childbirth`** — forty days is a *maximum*. Ibn Nujaym: "there is
  no limit to its minimum", and if the blood stops after an hour "she fasts and
  prays". Women routinely wait out the full forty and miss weeks of obligatory
  prayer.
- **`ghusl-after-period`** — braids do not have to be undone. Umm Salama asked this
  exact question and was told no. Ibn Qudama sets his own school's textbook aside on
  it.
- **`praying-on-period`** — no make-up is owed for missed prayers. New Muslims
  frequently assume a debt is accumulating.

The move in each is the same: state the corrective first, then show the text. Not
"here is the ruling, and by the way".

### The absence case, third instance

`birth-control-to-delay-period` joins `is-alcohol-in-perfume-najis` and
`jumuah-at-work`. One usable source in 140,379 chunks: Ibn Taymiyya answering a
question about `'idda`, who mentions in passing that a woman drinking a medicine
that stops or spaces her period is thereby in a state of purity. He is not ruling on
permissibility — he assumes it while answering something else.

That is enough to support the legal half and nothing like enough for the medical
half, and the answer separates the two explicitly. **The pattern now has a stable
shape:** find the principle or the incidental assumption, quote it, name the gap in
plain words, and hand the application to the reader and a scholar who knows their
case.

### Retrieval note

`quran-on-period` needed a second `also_retrieve` to reach Ibn Taymiyya's position,
and the query that worked was the *chapter title* of the fatwa it sits in
(`الطواف للحائض والجنب والمحدث...`), not a paraphrase of the position itself. The
position is stated in a passage about tawaf; nothing in it announces that it is
about Qur'an recitation. Same lesson as the fourth addendum from a different
direction: retrieve by where the sources put a thing, not by what the thing is about.

---

## Sixth addendum — section 8 (fasting), 38/38

Section 8 is complete. It was the first section where the *drafting* failed
repeatedly in a way retrieval was not responsible for, so this addendum is mostly
about that.

### The failure mode: cross-worksheet quote reuse

Seven citation/claim mismatches were caught in this section — more than in every
previous section combined. All the same shape: attaching a claim to a quotation that
lives in a *different question's* worksheet.

| Draft | What went wrong |
|---|---|
| `how-do-i-start-fasting` | iftar claims attached to suhoor quotes from Mughni 3:55 / Majmu' 6:361, neither in the worksheet |
| `how-do-i-start-fasting` (2nd pass) | `وأما ركنه فالامساك` is Bada'i 2:90 (`what-breaks-the-fast` P9), not Bada'i 2:76 (this worksheet's P9) |
| `forgot-and-ate` | al-Nasafi's Kanz list attributed to a quote that is Ibn Qudama citing the hadith; Kanz not in the worksheet |
| `swallowing-saliva` | cits 6/7 reused cits 1 and 5 for a different claim about food between the teeth |
| `swimming-while-fasting` | cited the janaba-at-dawn hadith (Bukhari 2:234) not in its worksheet |
| `mouthwash-fasting` | cited Ata's view from a chunk not in the worksheet |
| `injections-and-fasting` | arrow case and medicine-in-mouth cited from Bahr 2:487, not in that worksheet |

Three were caught by `commit`, four by re-reading before committing. **`commit`
verifies that a quotation exists in the chunk it names — it cannot verify that the
sentence around the quotation is about the same thing.** That gap is the whole
category.

Why here and not earlier: these 38 questions share source material to an unusual
degree. Al-Mughni 3:15–16, Kanz 1:221–224, Al-Mabsut 3:68 and Al-Bahr al-Ra'iq 2:487
each appear in a dozen worksheets, so after a few drafts the same passages are
familiar and the temptation to reach for one from memory is strong. Prayer and
purity spread across many more distinct chapters and never produced this.

**The rule that came out of it:** re-derive the chunk→passage map for the worksheet
in front of you and check every `passage=N` against *that* table before writing.
Never from memory, never from the previous draft. The map is positional and
worksheet-local; a number that was right an hour ago is meaningless in a new file.

### The pre-glossary drafts are suspect

`who-must-fast` was one of the nine answers drafted before the glossary work. It ran
entirely on Qur'an 2:183–185, covered only illness and travel, and missed both the
conditions of obligation and the whole *fidya* category. It was not subtly wrong; it
was materially incomplete. Deleted, re-prepared with
`من يجب عليه الصوم ومن يرخص له الفطر المريض والمسافر والشيخ الكبير`, and rewritten
against Al-Mughni 3:38 and 3:41–42.

That is exactly the failure the plan predicted for drafting against unglossed
retrieval — a practical fiqh question answered from scripture because scripture is
the only part of the corpus with English. **The other eight pre-glossary drafts
should be audited the same way before review.**

### Absence case, fourth instance

`does-smoking-break-fast` joins the set. Nothing in a pre-1836 corpus addresses
tobacco. The answer runs on the cavity principle instead — Al-Mughni 3:15–16,
`أنه يفطر بكل ما أدخله إلى جوفه`, and Al-Mabsut 3:68's `فالعبرة للواصل لا للمسلك`
— states the principle, names the gap, and hands the application over.
`perfume-while-fasting` is a near-miss of the same kind: the retrieval drifted into
Hajj and ihram chapters, which is genuine absence rather than a vocabulary gap, and
the answer falls back on the cavity principle for the same reason.

`fasting-long-summer-days` is the section's most honest limit. High-latitude timings
are a modern question; the classical texts fix the fast to the local horizon and
have no cap. The answer gives the harm concession (Al-Mughni 3:41–42's
`والصحيح الذي يخشى المرض بالصيام...`) as the door most people at those latitudes
actually go through, then says plainly that the corpus cannot settle which timings
to follow.

### Retrieval notes

Five questions needed retargeting. In every case the winning query was a phrase from
the *report itself*, not a description of the topic:

| Draft | Topic query | Phrase query |
|---|---|---|
| `toothpaste-and-fasting` | 0.70 | `السواك للصائم بالعشي وآخر النهار رطبا كان أو يابسا` → 0.9946 |
| `swimming-while-fasting` | 0.78 | `كان يصب على رأسه الماء وهو صائم من العطش والحر` → 0.9941 |

`fasting-long-summer-days` drifted twice into false friends worth recording:
Al-Mughni 2:65–66 is the *traveller's residence*, and Majmu' al-Fatawa 34:29 is
`'idda` — both retrieved on "long period" vocabulary and neither about fasting.

### Method note

The working loop from the fifth addendum held, with one addition made necessary by
the failure above:

1. Test the Arabic query with `retrieve.ts` before spending a `prepare` cycle
2. `prepare` several slugs at once
3. **Re-derive chunk→passage for every worksheet, and keep the table visible while writing**
4. Dump candidate chunks via `psql`
5. Verify every candidate quote in one `checkQuotes.ts` call
6. Write, commit, then run the duplicate-`cited_text` check

Step 5 caught the usual leading-particle rejections — `ومنها أن الحائض` for
`منها أن الحائض`, `أنه محمول` for `انه محمول`, `وذهب أحمد` for `فذهب أحمد`,
`ومنها النية` for `فمنها النية`. These are cheap to fix before writing and expensive
after.

One new `commit` check surfaced in this section: it flags a source *named in the
prose* with no citation behind it, even when the name appears inside a quotation
being reported (al-Nawawi citing al-Nasa'i, Ibn Qudama citing Abu Dawud's question to
Ahmad). Three drafts tripped it. The fix is always to attribute to the author whose
book is actually cited, not to the name inside their sentence — which is the correct
scholarly habit anyway.

**Running total: 184/469 drafted, all `status='draft'`, nothing published.**

### The pre-glossary audit, resolved

All nine were re-read against their citation profiles. **`who-must-fast` was the
only defective one.** The other eight stand as written.

The signal that flagged them was Qur'an-dominance: 25 of the 30 citations across the
eight are Qur'an, and not one is hadith — the exact fingerprint the main audit
identified as a retrieval miss. Reading them showed the fingerprint has two honest
false-positive classes:

- **Questions whose evidence genuinely is a specific verse.**
  `food-cooked-by-non-muslims` runs on 5:3, 5:5 and 24:61; `friends-who-arent-muslim`
  on 60:8–9 against 3:28. These are not fiqh questions that fell back to scripture —
  they are questions scripture answers directly, and the fiqh is the secondary layer.
- **Pastoral answers and deflections, where a light citation load is the point.**
  `suicide-in-islam` and `my-parents-will-go-to-hell` are consolation answers; the
  severe hadith material on suicide would actively harm the reader it is written for,
  and its absence is an editorial decision, not a retrieval gap. `did-my-divorce-count`
  and `is-insurance-allowed` are deliberate declines, and two or three citations is
  the right weight for one.

`what-is-riba` and `is-a-mortgage-allowed` had already been rebuilt after the
original catch and are the strongest of the nine.

**Consequence for `auditTiers.ts` (plan step 1).** Qur'an-dominance is a good
detector but it must not fire on `expect: decline`, and it should be read alongside
whether the question is one the Qur'an addresses in its own voice. Flagging on
kind-mix alone would have condemned four sound answers to be rewritten worse.

**Incidental defect found:** `answers.updated_at` is not maintained by
`draft.ts commit` — a rebuilt answer keeps its original timestamp, as `who-must-fast`
still does. That column cannot currently be used to tell a reviewer when a draft last
changed, and the review UI should not rely on it until `commit` sets it.

---

## Seventh addendum — section 9 (zakat and charity), 17/17

Section 9 is the cleanest section drafted so far. Zero `commit` flags across all
seventeen, zero citation/claim mismatches found on re-read, and no answer needed
rebuilding. Two reasons, both worth carrying forward.

### Why retrieval behaved

The glossary already covered zakat vocabulary — *nisab*, *hawl*, *'urud al-tijara*,
*sadaqat al-fitr* — so English queries landed inside `kitab al-zakat` directly
instead of falling back to scripture. All seventeen `also_retrieve` queries were
tested with `retrieve.ts` before any prepare cycle and scored 0.93–0.99. Nothing
needed retargeting after the fact, which is the first section where that is true.

The practical lesson is about ordering, not about zakat: **the glossary work pays
off inside a topic, not across topics.** Section 8 needed seven retrieval
retargets because fasting vocabulary was thin; section 9 needed none because the
zakat entries were already in place from the earlier gap-closing pass. Sections
still to draft should have their vocabulary tested *before* the first prepare, not
discovered through failed worksheets.

### The one structural hazard, and how it was handled

Section 9's seventeen questions share source material even more heavily than
section 8's — Al-Fatawa al-Hindiyya 1:179, Bada'i al-Sana'i 2:49–50,
Al-Tamhid 14:263-264 and 17:129-130, and Ahkam al-Qur'an (al-Jassas) 4:338–339
each appear in five or more worksheets. The re-derive-the-map discipline adopted
after section 8 caught the problem before it became a defect rather than after:

| The quote that belonged elsewhere | Landed in | Needed by | Resolution |
|---|---|---|---|
| Bada'i 2:50 — zakat to relatives other than parents/children | `zakat-to-non-muslims` | `zakat-to-family` | Used Bada'i 2:49 (in family's own sheet), which carries the rule *and* its reasoning |
| Hindiyya 1:188 — `ولا يدفع إلى أصله وإن علا وفرعه` | `zakat-to-non-muslims` | `zakat-to-family` | Same; al-Jassas 4:338 in family's sheet states the rule with the madhhab survey |
| Al-Hidaya 1:97 — `لا زكاة في مال الضمار` | `zakat-on-property` | `zakat-on-pension` | Not forced. Pension built on Al-Mughni 2:344-345 (restraint on disposal) and Muwatta 1:254-255 (the long-absent debt), both in its own sheet |
| Bukhari 2:115 — `أي الصدقة أعظم أجرا` | `charity-anonymously` | `how-to-give-charity-best` | Muslim 2:717 in that sheet carries the same hadith in fuller wording |

**In every case the fix was to find the equivalent inside the worksheet in front of
me, never to widen the worksheet.** Re-preparing renumbers passages and can evict a
chunk already quoted; three of these four had a perfectly good substitute already
retrieved. The rule that emerges: when a quote you want is on the wrong sheet, look
for its twin before reaching for `prepare`.

### A false positive for the Qur'an-dominance detector, of a new kind

`how-to-give-charity-best` retrieved **zero** fiqh chunks and four off-target
Qur'an passages (60:1, 2:246, 65:6, 49:15). Under the plan's step-1 signal it would
have been flagged as a miss.

It was not a miss. The question is answered in the hadith literature, not the fiqh
manuals, and retrieval landed on exactly the right chapters — Nasa'i's
`باب أي الصدقة أفضل`, Muslim's `باب بيان أن أفضل الصدقة صدقة الصحيح الشحيح`, and
al-Qurtubi's enumeration at 17:243. The answer runs on seven citations from four
works and needed no widening.

This is a **third** false-positive class, distinct from the two recorded in the
pre-glossary audit: not a question the Qur'an answers in its own voice, and not a
pastoral decline, but **a question whose home is `kitab al-zakat` in the hadith
collections rather than in fiqh.** `auditTiers.ts` should require the absent kind to
be the one the question actually needs — a low fiqh count on a virtue question is
not evidence of anything.

### `expect: decline` handled as designed

`zakat-on-pension` is the section's only decline, and it is a good model for the
category: it names the two competing classical analogies (wealth you cannot reach
versus a debt that will come to you), cites six passages for them, and then declines
to choose — because the choice turns on the terms of the reader's particular scheme,
which no premodern text can supply. It ends with four questions to put to a scholar.
A decline that hands the reader the reasoning is worth more than one that says only
"ask someone".

### Method note

The section-8 loop held without modification: test the Arabic query with
`retrieve.ts` → `prepare` in batches of 3–7 → **re-derive chunk→passage per
worksheet and keep the table visible** → dump candidates via `psql` with
`left(c.content, N)` → verify every quote in one `checkQuotes.ts` call → write in one
Python heredoc → commit in one loop → duplicate-`cited_text` check.

Two additions from this section:

- **Verify late-added quotes too.** Two claims in `charity-anonymously` and one in
  `zakat-to-non-muslims` were written as bolded quotations while drafting prose,
  after the batch verification had already run. Each was pulled back, verified, and
  given a citation before commit. `commit` would have flagged the source names, but
  only because they happened to be named — an unattributed bolded paraphrase would
  have passed. **Anything in bold must go through `checkQuotes.ts`, including
  quotes added after the batch.**
- **Watch `also_retrieve` insertion at section boundaries.** The block appended for
  `charity-anonymously` landed *after* the `# 10. Hajj and Umrah` comment banner,
  because the insertion regex consumes trailing comment lines as part of the
  question's block. It still parsed — YAML strips comments — but it read as though it
  belonged to the next section. Fixed by hand. The pattern needs a guard if it is
  used again on the last question of a section.

---

## Eighth addendum — section 10 (Hajj and Umra), 10/10

**211/469 drafted.** Zero `commit` flags, zero duplicate `cited_text`, nothing
published. The second consecutive section drafted without a single retrieval
retarget.

### Retrieval: the section-9 lesson held

All nine Arabic probe queries were run through `retrieve.ts` **before the first
`prepare`**, as the seventh addendum recommended. Every one landed inside `kitab
al-hajj` of the right work (rerank 0.86–0.99); none needed retargeting. Ten
`also_retrieve` entries went into `questions.yaml` on the strength of those probes
and were never revised.

That is now twice in a row. The rule is no longer provisional: **probe a section's
vocabulary before spending a prepare cycle, not after a worksheet disappoints.**

### The exit-137 kill: mitigated, not diagnosed

The Hajj batch-A `prepare` loop died with SIGKILL after four of five worksheets.
On resume, memory was ample (7.3 GB available, 18 MiB VRAM in use with
`serve_embeddings` resident), and re-running the same five slugs **in batches of
three** completed without incident — twice. No OOM evidence was recoverable
(`dmesg` is not readable in this environment), so the cause is unconfirmed; the
correlation with batch size is the only signal.

**Working rule: cap `prepare` loops at three worksheets.** Revisit only if the
kill recurs at that size.

### The failure mode this section actually exposed

Not misquotation — `checkQuotes.ts` passed 172 quotes across ten worksheets with
zero misses. The failure was **plain narrative assertion**: a rule stated as fact
in unbolded prose, carrying no `[N]` and naming no source, so `commit` had nothing
to flag. Four instances, all caught on self-review after a clean commit:

| Slug | Claim | Resolution |
|---|---|---|
| `hajj-on-behalf-of-someone` | "the Shafi'is **and Hanbalis** treat it as a debt on the estate" | Al-Majmu' names only al-Shafi'i, Ibn 'Abbas and Abu Hurayra. Hanbali attribution removed. |
| `broke-ihram-rules` | "deliberate intimacy before 'Arafa invalidates the Hajj" | True, and cited on *another* worksheet (Hindiyya 1:219). Rewritten as a report of what the jurists hold, not a ruling issued here. |
| `period-during-hajj` | "medical postponement is permitted by contemporary scholars" | An unsourceable claim about living scholarship. Replaced with a referral, plus an explicit note that the sources here do not address it. |
| `period-during-hajj` | "the classical texts place no end to its time" | True (Al-Majmu' 8:266) but on a different sheet. Clause deleted. |
| `what-happens-at-hajj` | the 10th-day ordering of stoning before slaughter | The only one **fixed by adding evidence** rather than softening: Muwatta 1:390–393 carried the twin, verified and added as citation 21. |

The seventh addendum's rule — *anything in bold goes through `checkQuotes.ts`* —
is necessary but not sufficient. Bold is what triggers verification; unbolded
prose slips past both `commit` and the drafting habit. **Extend the rule: any
sentence that states a rule as fact must either carry a marker, or be visibly
framed as a report of a cited claim.** A tightened `commit` check is possible
here — flag a school name (Hanafi/Maliki/Shafi'i/Hanbali) or a jurist's name in
prose with no `[N]` within the same sentence — but it would fire on legitimate
recapitulation, so it is a lint, not a gate.

### The cross-worksheet twin rule held a second time

Four quotes wanted by one worksheet were sitting on a neighbour's: Al-Mughni
3:91–92 (wanted by `hajj-on-behalf-of-someone`, on `hajj-if-i-cant-afford`'s
sheet), Hindiyya 1:219's `يفسد الحج بالجماع قبل الوقوف` (wanted by
`broke-ihram-rules`), Al-Majmu' 8:266's `لا آخر لوقتها` (wanted by
`period-during-hajj`), and the Shubruma hadith (wanted by
`hajj-on-behalf-of-someone`, on `hajj-if-i-cant-afford`'s sheet). **No worksheet
was re-prepared.** Each was resolved by finding the twin in front of me
(Al-Majmu' 7:112 for the first) or by dropping the claim. Renumbering hazard
avoided again.

### Two corpus observations

- **`CHECK [11]` in a passage header is not a pipeline flag.** `Fatawa Qadi Khan
  1:140` renders its heading as `Fatawa Qadi Khan 1:140 — CHECK [11]`. That string
  is OpenITI editorial text carried into `heading_path`; `canonical_ref` is clean
  (`Fatawa Qadi Khan 1:140`). Safe to cite. Recorded so it is not re-investigated.
- **A volume-wide ref surfaced as a candidate.** `hajj-on-behalf-of-someone`
  passage 12 was `Tafsir al-Qurtubi 2:1-436` — one of the 678 uncheckably wide
  ranged refs. It was not cited. **Never cite a passage whose ref spans a whole
  volume**; the page claim is unverifiable by a reader, which is the whole point of
  the citation.

### Sections 1–10 complete

193 + 10 section questions plus 8 scattered = 211. Next by size, with Money and
work (28) and Health and medicine (11) still held back.

---

## Ninth addendum — section 16 (marriage and relationships), 33/33

*The largest section drafted so far, and the one where the register mattered
most. 33 questions, one of them `expect: decline`; every answer clean on
`commit`'s source-name check by the time it was stored.*

- **Vocabulary probed before drafting, as the rule now requires.** 20 Arabic
  queries run through `retrieve.ts` first; 3 needed retargeting before use
  (mahr, handshake, `'azl` — each recovered by naming the chapter heading or the
  hadith wording rather than the concept), and all 20 landed in `kitab al-nikah`
  of the right work before a single `prepare`. `also_retrieve` added for all 33
  questions.
- **The section-boundary guard is now in the insertion code, not in my hands.**
  The seventh addendum flagged that the insertion regex absorbs a trailing
  comment banner. The section-16 pass strips trailing blank and `#` lines from
  the matched block before appending. Verified: `being-alone-with-opposite-gender`
  keeps its `also_retrieve` above the `# 17. Money and work` banner.
- **A worksheet may be re-prepared safely *before* its first quotation is
  committed.** Two were: `what-makes-a-nikah-valid` (16 → 31 passages) and
  `revert-woman-no-muslim-wali` (23 → 31). The renumbering hazard recorded in
  earlier addenda applies only after quotes are in hand. Widening early is cheap
  and was the right call both times — the first pass on `what-makes-a-nikah-valid`
  had four off-target Qur'an passages and no text on consent at all.
- **`commit`'s source-name flag caught a real defect, not a false positive.**
  `what-makes-a-nikah-valid` attributed a report to al-Tirmidhi while the citation
  behind it resolved to Al-Majmu' quoting him — a reader clicking through would
  land on the wrong book. The fix was not to soften the prose but to cite the
  primary: Jami' al-Tirmidhi 2:396–398 was already on the worksheet, carrying the
  same words in Tirmidhi's own wording. **When the flag fires on an author quoted
  inside another work, look for the primary on the sheet before rewording.**
  Note also that the check reads the whole answer, translations included — moving
  the name into the Arabic quotation does not clear it, and should not.

- **The re-prepare rule paid off twice more, and one case shows why the probe
  rule matters even with `also_retrieve` already written.**
  `registering-marriage-legally` came back with 16 passages of which four were
  usable: the probe `أركان النكاح` had retrieved **the corners of the Ka'ba**
  (Al-Minhaj 9:14, on which corners are touched in tawaf), because *arkan* is
  the same word. Rerunning with `إعلان النكاح`, `الإشهاد على النكاح لدفع الجحود`,
  `الكتاب أوثق وأحفظ للحقوق` and `طاعة السلطان فيما ليس بمعصية` gave 38 passages
  and every strand the answer needed. `online-nikah` likewise went 21 → 32 once
  `اتحاد المجلس` — the actual technical term — replaced the generic phrasing.
  **A homograph in the probe is invisible in the score and obvious in the
  results: read what came back, not what it scored.**
- **A low rerank score on a correct source is still not a signal.**
  `الكتاب أوثق وأحفظ للحقوق` scored 0.29 at the top and returned Ibn al-'Arabi
  and al-Jassas on *ayat al-dayn* plus Al-Mughni's *kitab al-shahadat* — exactly
  right. Third confirmation of the rule.
- **A Qur'an quotation must be lifted from the chunk, not retyped.** The first
  attempt at 2:235 failed `checkQuotes` on one character: `إِلَّآ` transcribed
  with U+0622 (alef-madda) where the chunk has alef + U+0653. `words()` strips
  harakat but not the madda sign, so the two do not fold together. Fix: slice the
  span out of `chunks.content` in a script and write it straight into the file.
  **For any Qur'an Arabic, extract programmatically.**
- **The `commit` source-name flag has two distinct causes, and only one is a
  bug.** A bank-wide query found 21 answers carrying standing flags, every one of
  them naming a collector in prose. Three were pure transliteration false
  positives — prose "Abu Dawud" against canonical_ref `Sunan Abi Dawud` — and
  `guardrails.ts` now folds `Abu`/`Abi`/`Abo` before comparing, with a test.
  The other 18 are **not** false positives: the prose names Bukhari or Tirmidhi
  while the citation resolves to Fath al-Bari or Al-Majmu' *quoting* them. That
  is the same defect the seventh addendum recorded on
  `what-makes-a-nikah-valid`, and it is left flagged deliberately — a reader
  clicking through lands on the commentary, not the collection.
- **Answers written this session:** the courtship cluster
  (`is-dating-allowed`, `how-do-muslims-meet-to-marry`,
  `talking-to-someone-before-marriage`) and the contract cluster
  (`marrying-someone-my-family-hates`, `online-nikah`,
  `registering-marriage-legally`). All six clean on commit; 89 quotations
  through `checkQuotes.ts` with one miss, the Qur'an codepoint above.
- **Self-review caught the narrative-assertion failure mode three times more**,
  always in the closing "so, practically" paragraph — where the advice restates
  a rule established above but carries no marker. The rule from the section-10
  addendum holds and this is where it bites: **the practical summary is the
  paragraph most likely to state a ruling bare.** Fixed in
  `how-do-muslims-meet-to-marry`, `talking-to-someone-before-marriage` and
  `registering-marriage-legally` by carrying the markers into the advice.
- **Two answers had to decline to rule, and the evidence supports the
  declining.** `online-nikah` turns on whether a video call is one *majlis*; the
  Hanafi texts on marriage by letter and messenger (Al-Bahr al-Ra'iq 3:148, Radd
  al-Muhtar 3:15-16) give the reasoning a contemporary scholar uses but do not
  reach the case. `marrying-someone-my-family-hates` turns on *kafa'a*, which the
  passages bound (Radd al-Muhtar 3:90-91: refusal over a non-*kufu'* or a low
  dower is not *'adl*) without defining. **Stating precisely which sub-question
  the sources do not reach is more useful than a hedge over the whole answer.**

- **The escaped-quote defect is now caught at `commit`, not after.** A `\"`
  written inside a citation quote is stored verbatim and renders as a stray
  backslash in the daleel. It bit `hajj-if-i-cant-afford` in an earlier session
  and `intimacy-in-marriage-limits` in this one; a bank-wide query then found
  **four more** already stored (`two-people-congregation`,
  `what-to-recite-in-prayer`, `what-to-say-when-breaking-fast`,
  `zakat-on-gold-jewellery`), all now repaired. `draft.ts commit` refuses such a
  citation outright — the parser is anchored to end of line and tolerates a bare
  `"`, so the escape is never needed and is always a mistake. Verified by
  reintroducing one and watching the commit fail.
  **`checkQuotes.ts` cannot catch this**: the quote passes there because it is
  handed over unescaped, and the escape enters when the line is written to the
  worksheet. The gap is between the two steps, which is why the guard belongs in
  `commit`.
- **Answers written this session (continued):** `intimacy-in-marriage-limits`,
  `friendship-with-opposite-gender`, `hugging-relatives` — bringing section 16 to
  30/33 and the bank to 238/469. Remaining in the section:
  `zina-what-if-i-did-it`, `masturbation-ruling`, `pornography`,
  `being-gay-in-islam` — the four that need the most care on register — plus
  `did-my-divorce-count`, which is `expect: decline`.
- **`intimacy-in-marriage-limits` needed the probe rule too**: the first pass, on
  a single `also_retrieve` line, returned 16 passages with nothing on
  menstruation at all. Adding `فاعتزلوا النساء في المحيض` and
  `التمتع بالحائض فيما فوق الإزار` took it to 32 and supplied both agreed limits
  and the four-school split. **One `also_retrieve` line is rarely enough for a
  question with more than one strand.**

- **The last four questions were the hardest, and the corpus handled them better
  than expected.** `masturbation-ruling`, `zina-what-if-i-did-it`, `pornography`
  and `being-gay-in-islam` all needed a register the fiqh books do not supply on
  their own, but each turned out to have a precise, quotable text at its centre:
  - Ibn Taymiyya, *Majmu' al-Fatawa* 34:229-230, states the majority prohibition
    on *istimna'* **and** names the dissent and the necessity concession in four
    lines. Reporting the range honestly needed one passage.
  - *Majmu' al-Fatawa* 34:180 answers the zina question directly: **repentance is
    valid without confessing so that the penalty be applied.** That is the single
    most important sentence in the section, and without it the answer would have
    drifted toward hudud material that has no business being shown to someone
    asking how to repent.
  - Ibn Hajar, *Fath al-Bari* 11:281, gives a four-level taxonomy of what happens
    in the heart — *waswasa*, *taraddud*, *hamm*, *'azm* — with the first three
    explicitly pardoned. For `being-gay-in-islam` this is exactly the
    inclination-versus-act distinction the question's `note` asks for, stated by
    a canonical commentator rather than constructed by me.
- **Deliberate omission, recorded so it is a decision and not an oversight.**
  `being-gay-in-islam` retrieved Sunan Abi Dawud 6:510-512, the narration
  prescribing death. It is **not** cited. The answer says so and says why: the
  penalty is a court matter under conditions effectively never satisfiable, it
  bears nothing on how a person lives, and quoting it at someone asking this
  question would be gratuitous. **Naming the omission in the answer is the honest
  form of this** — silently pretending the corpus lacks such material would be a
  different kind of dishonesty.
- **The practical-summary paragraph is where the narrative-assertion failure mode
  lives.** Self-review caught it three more times this session, always in the
  closing "so, practically" block. Also caught one genuine unsourced claim in
  `being-gay-in-islam` — an appeal to "the classical instruction elsewhere in the
  tradition" about privacy, whose supporting *satr* passages are on the
  `zina-what-if-i-did-it` worksheet, not this one. **Cross-worksheet twin rule
  applied: no twin on the sheet, so the claim was dropped rather than widened.**
- **`contraception` and `intimacy-in-marriage-limits` both needed re-probing**;
  each had a single `also_retrieve` line and came back missing an entire strand.
  For `contraception`, `حكم العزل وإذن المرأة الحرة` was what surfaced Fath
  al-Bari 9:269, Al-Majmu' 16:422-423 and Al-Mughni 7:227-228 — i.e. the wife's
  consent, which is the condition the whole answer turns on. **A one-line
  `also_retrieve` is a warning sign, not a completed step.**
- **Section total: 33/33. Bank total: 243/469.**

## Tenth addendum — section 12 (belief and aqidah), 29/29

*The first section where the honest answer repeatedly turned out to be "the
famous version of this is weaker than people think." Three answers rest on a
collector or a commentator undercutting the very text being quoted.*

- **New failure mode: crossing two worksheets' passage maps in one script.**
  Writing `what-are-the-pillars-of-islam` and `what-are-the-pillars-of-faith` in a
  single `python3` heredoc, I used passage numbers from one sheet in the other's
  citation list. `commit` rejected both, naming the mismatched work — the check
  did exactly its job — but the fix cost a re-derivation of both maps.
  **Rule: one worksheet per splice call, with its map re-derived immediately
  before.** The existing rule said never recall a map from memory; this adds that
  holding two maps in the same working step is the same mistake in a different
  disguise.
  The recovery followed the twin rule both times. On the *islam* sheet there was
  no twin for al-Nawawi on why these five were named, so **the claim was
  dropped**. On the *faith* sheet there were twins — Majmu' al-Fatawa 7:360-362
  quotes Ibn al-Salah with the same content al-Minhaj 1:148 carries, and supplies
  a better line besides (`الأعلى هو الإحسان والإحسان يتضمن الإيمان والإيمان يتضمن
  الإسلام`), so the citations were **repointed rather than removed**.
- **All 29 questions probed before any `prepare`, and every probe landed on the
  right kind of source.** Majmu' al-Fatawa carries this section the way Al-Mughni
  and Al-Majmu' carried the fiqh sections — Ibn Taymiyya's *Kitab al-Iman* and his
  *Qa'ida fi tawhid Allah* are the two texts most of the creed answers rest on.
- **One probe per question is not enough here either.** The first pass gave
  16-passage sheets with real drift — `what-is-tawhid` returned the *debt* verse
  at passage 3. Adding a second and third strand per question took the same
  worksheets to 24-29 passages and surfaced the material the answers actually
  needed. `prepare` runs one retrieval pass per `also_retrieve` line, so the
  count of probes is roughly the width of the sheet.
- **`auditTiers.ts` had to be fixed before this section could be audited at all.**
  Its scripture-top signal assumes a practical question; over section 12 it would
  have flagged all 29, since a creed question answered from the Qur'an has found
  exactly what it needed. Sections are comments in `questions.yaml` and `parse()`
  drops them, so the script now reads them from the raw text and exempts sections
  11, 12 and 24.

### The pattern this section turned up: the source grading itself

Three answers are built on a text that arrives with its own health warning
attached, and in each case the warning is the most useful thing on the page.

- **`what-are-the-names-of-allah`.** The hadith carrying the number and the
  promise is in Sahih al-Bukhari and contains **no list**. The famous list of 99
  comes from Jami' al-Tirmidhi — where al-Tirmidhi himself writes `هذا حديث
  غريب... ولا نعرفه إلا من حديث صفوان بن صالح`, and adds that he knows of no other
  narration mentioning the names. Ibn Taymiyya (Majmu' al-Fatawa 6:379-381) then
  states that the hadith specialists **agreed the enumeration is not the Prophet's
  words** but the speech of some of the salaf, and that Sufyan b. 'Uyayna and Ahmad
  compiled a *different* ninety-nine from the Qur'an. The promise is untouched;
  what changes is the reader's relationship to the poster on the wall. Al-Bukhari
  glosses `أحصيناه` as `حفظناه` inline in the same chunk — a two-word citation, and
  it verifies.
- **`sunni-shia-difference`** (`expect: decline`). Al-Tirmidhi grades the plain
  seventy-three-sects report `حسن صحيح`, and grades the version carrying `كلهم في
  النار إلا ملة واحدة` as `مفسر غريب، لا نعرفه مثل هذا إلا من هذا الوجه`. **The
  clause that turns the report into a weapon is the clause its collector flags as
  singular.** Paired with Ibn Taymiyya (Majmu' al-Fatawa 3:345-346) naming the
  my-faction-is-the-saved-sect reflex as `ضلال مبين`, the decline is grounded in
  Sunni evidence rather than in reticence.
- **`are-prophets-sinless`.** Ibn al-'Arabi reports consensus on protection from
  major sins and *ikhtilaf* on minor; Ibn Taymiyya reports the minor-sins-possible
  view as that of most scholars of Islam — and was asked about a man **declared a
  disbeliever for holding it**, ruling that such takfir resembles the ghulat. Two
  major scholars on opposite sides, and one of them ruling that making it a
  boundary of belief is the actual error.

### The three `expect: decline` answers

All three follow the established model — state the framework with daleel, then
refuse the outcome and refer — but each declines on a *different* ground, and the
ground is stated:

| slug | why it declines |
|---|---|
| `is-this-person-a-kafir` | the ruling turns on the person's belief, on whether interpretation or excusable ignorance applies, and on facts no retrieval system holds; and the reports place the cost of a wrong accusation on the accuser |
| `which-madhhab-should-i-follow` | the sources give criteria for *who is qualified to be followed*, not a ranking; what decides is where you live and who can teach you |
| `sunni-shia-difference` | **the library is one-sided** — 37 Sunni works, no Shia primary source; a verdict would be decided by the shelf, not the evidence |

The third reason is new and worth keeping. It is an argument from this app's own
constraints, and it is the kind of limit a reader can verify on the sources page.

- **`is-this-person-a-kafir` found the strongest single line for a decline.**
  Ibn 'Abd al-Barr, Al-Tamhid 17:20-21: what was agreed to be within Islam is not
  removed from it by later *disagreement* — `ولا يخرج من الإسلام المتفق عليه إلا
  باتفاق آخر أو سنة ثابتة لا معارض لها`. A settled fact is not undone by a
  contested opinion. That disposes of nearly every case a reader actually asks
  about, before any facts about the person are needed.
- **A deliberate omission, recorded.** `which-madhhab-should-i-follow` cites
  Majmu' al-Fatawa 4:176-178 for why those four imams became the ones followed.
  The same chunk continues into a polemic condemning anyone who follows one imam
  in law while holding a different school's creed (`من قال أنا شافعي الشرع أشعري
  الإعتقاد قلنا له هذا من الأضداد لا بل من الارتداد`). **Not cited**, and the
  answer says so and why: it is a creed argument from another era, not guidance on
  choosing a school of fiqh, and reproducing it would misrepresent both the
  question and a large part of the Sunni tradition. Naming the omission is the
  honest form — the same practice as `being-gay-in-islam`.

### Retrieval notes

- **Homograph drift, again, and again invisible in the score.**
  `can-i-read-the-bible` probed for `حديث عمر في الصحيفة من التوراة` and got back
  Tafsir al-Qurtubi 11:164 — **'Umar's *conversion* sahifa**, the one containing
  Surat Ta-Ha. Same word, different incident. The same sheet also returned
  Al-Majmu' on marrying People of the Book and on jizya, and Al-Majmu' 15:321-322
  on 'Umar's Khaybar *waqf*. Four of 32 passages were on-target drift from a
  perfectly reasonable Arabic probe. **Read what came back.**
- **A quotation may span a paragraph break in the chunk and still commit.**
  `can-i-read-the-bible` citation 2 (Tafsir al-Tabari 18:420-422) crosses a `\n\n`
  in `chunks.content`. Written on one line with a single space, it passes both
  `checkQuotes` and `commit`, because `words()` collapses whitespace on both
  sides. Worth knowing: the constraint is *one line in the worksheet*, not
  *contiguous in the source*.
- **Chunk-slicing is now the default for Arabic, not just for Qur'an.** Every
  Arabic quotation in this section was extracted programmatically from
  `chunks.content` by anchor pair rather than transcribed. Zero quote failures
  across 29 answers — against the earlier rate of one or two per section, all of
  them silent codepoint mismatches.

---

## Eleventh addendum — section 13 (food and drink), 23/23

The section with the largest gap between what a reader asks and what the corpus
contains. Every other section so far has been a matter of *finding* the chapter;
this one repeatedly turned out to be a matter of the chapter not existing,
because the question is about an industrial process no pre-1836 jurist saw.

### Vocabulary paid for itself twice, visibly

`also_retrieve` was written for all 23 questions before any drafting (2–3 Arabic
probes each). Two cases where the English question retrieved nothing and the
Arabic term retrieved the chapter outright:

| Question | English probe | Arabic probe | Landed on |
|---|---|---|---|
| alcohol cooked off in food | 0.37, scattered | *al-tila' wa'l-matbukh* | 0.994 — 'Umar rationing reduced grape syrup; Ahmad: *"it does not intoxicate, and had it intoxicated, 'Umar would not have permitted it"* |
| non-alcoholic beer | nothing usable | *al-fuqqa'* | Ibn Qudama: *"there is no harm in fuqqa'"*; Malik asked directly: *"if it does not intoxicate, there is no harm in it"* |

Neither term is guessable from the English. Both are the ordinary name of the
thing in the sources. This is the glossary argument from the plan, confirmed a
fourth and fifth time.

**Sheet width tracks probe count.** `prepare` runs one retrieval pass per
`also_retrieve` line: 2 probes ≈ 22–24 passages, 3 ≈ 31. Worth deciding before
`prepare`, because passage numbers are positional and re-preparing renumbers
everything — a hazard only *after* quotes are committed.

### Five declines, and what makes this section's declines different

`stunning-before-slaughter`, `is-gelatin-halal`, `e-numbers-additives`,
`vanilla-extract-alcohol`, `halal-certification-labels`.

The declines in sections 12 and 16 turned on *jurisdiction* — the ruling needs
facts about a person, or the library is one-sided. These five turn on something
narrower and more interesting: **the sources never performed the classification
step the modern question requires.** Whether industrially produced ethanol used
as a solvent is *khamr* at all; whether bovine collagen hydrolysed past
recognition is still the animal; whether an E-number names a substance or a
process. The fiqh for each classification exists and is sharp. What is missing
is the fact that would tell you which classification applies.

Bada'i al-Sana' 5:113 is the clearest statement of the machinery, and it is a
two-level ruling: mix khamr into water until taste and smell are gone and the
*name* is gone (so no hadd), but the *parts* remain, so drinking it stays
forbidden — `فقد زال الاسم والمعنى الا أنه يحرم شرب الماء الممزوج بالخمر لما فيه
من أجزاء الخمر حقيقة`. A modern answer that stops at "the alcohol is negligible"
has answered the *name* question and ignored the *parts* question. The decline
says so, rather than picking one.

`halal-certification-labels` closed the section and is the cleanest example of
what a decline can still deliver. Al-Mabsut 10:165 and 10:171 supply an entire
decision procedure for the reader: a report about lawfulness is a *religious*
report, so one trustworthy person suffices to stop you; a report about the
substance binds, a report about the seller's title only makes avoidance
preferable (`وإن لم يتنزه كان في سعة من ذلك`); and — the part most often
missed — **deadlock resolves to the default, not to prohibition**
(`فإن لم يكن له رأى تمسك بأصل الطهارة`). Paired with al-Khattabi's three classes
of *wara'* in Fath al-Bari 4:250, which names a **disliked** class — avoiding
the concessions the Law granted, `على سبيل التنطع` — the answer gives a reader
more usable guidance than a verdict on any certifier would have.

### Four quote failures, all caught before commit

The first section since chunk-slicing became default where the guard rail
actually fired, and each failure was a different mechanism:

- **A misremembered translation.** `what-food-is-forbidden` had "But whoso is
  driven by necessity" for Qur'an 2:173; Pickthall reads **"But he who is driven
  by necessity"**. Caught by `checkQuotes`. English quotations are the remaining
  hand-typed surface, and this is exactly why they go through the checker too.
- **Hamza form in the anchor.** Majmu' al-Fatawa 10:643 carries `إستبرأ`
  (alif-hamza-*below*), not `استبرأ`. The anchor missed; fixed by reading the raw
  chunk around the target rather than adjusting the anchor by guess.
- **An OCR artifact inside the target span.** Abu Dawud 5:350 contains `وحزم`
  where `وحرم` is meant. The quote was trimmed to stop before the artifact.
  Reproducing a scanning error inside quotation marks would be a fabricated
  citation, however faithfully copied.
- **The escaped-quote guard, third fire.** `eating-etiquette` citation 2 spanned
  a bare `"` in the chunk, which Python escaped into `\"` in the worksheet line.
  Trimmed to start after it. This guard has now caught three real errors and no
  false ones.

### Source-name flags: one deliberate, one a genuine slip

`what-if-i-ate-pork-by-accident` names Ibn Majah *inside* an Al-Ashbah quotation
— the grading statement itself. No primary was on the sheet, so the flag was
left standing for the reviewer, as with eighteen earlier cases.

`e-numbers-additives` was different: my own prose said "in the wording Sahih
Muslim carries" while the citation was to Majmu' al-Fatawa. That is the flag
working as designed — it caught an attribution the reader would have taken as a
direct sighting of Muslim. Reworded to "in another wording he cites". **The flag
is not only a formality about un-cited primaries; it also catches the drafter
implying a source he did not open.**

### One operational note

`food-cooked-by-non-muslims.md` already existed as a 12-passage sheet prepared
*before* the glossary work. It was deleted, re-prepared at 23 passages, and the
answer rewritten from scratch rather than extended. Pre-glossary worksheets are
not worth salvaging; the evidence base is different enough that the answer built
on it is a different answer.

### Sections 1–13 and 16 complete — 294/469

---

## Twelfth addendum — section 14 (dress and appearance), 21/21

The section where the *reader's* question and the *sources'* question diverge
most often — and where, unusually, the classical commentators are consistently
*less* restrictive than the topic's modern reputation.

### The recurring finding: the commentators narrow, they do not widen

This happened in six of the twenty-one answers, always in the same shape — a
severe-sounding text, then a commentator drawing its scope in:

| Text | Narrowed by |
|---|---|
| *whoever imitates a people is one of them* | Ibn Abi Jamra: the wording appears to rebuke imitation in everything, "but it is known from the other evidences that what is meant is imitation in outward style, and in some traits and movements — not imitation in matters of good" |
| *what is below the ankles is in the Fire* | Ibn Hajar: "this unrestricted wording is carried onto what came with the qualification of arrogance — that is what the threat came concerning, **by agreement**" |
| a woman must not go out perfumed | Ibn Hajar: "the prohibition on her is **specific to the state of going out**"; al-Nawawi: after she returns home "she is not prevented from perfuming herself" |
| *nams* is cursed | al-Nawawi: "the prohibition is only in **the eyebrows and what is at the edges of the face**" |
| the *fitra* practices | al-Nawawi: "**most of these traits are not obligatory** in the view of the scholars" |
| a thing that is the mark of non-Muslims | Ibn Daqiq al-'Id: "the second meaning **does not entail prohibition**", citing al-Shafi'i treating it as *adab* |

An answer bank built by matching a reader's question to a hadith and stopping
there would get all six of these wrong in the strict direction. The commentary
layer is not decoration; on this section it is the ruling.

### Where the sources are franker than expected

- **Al-Shafi'i letting the barber shave his underarm**: "I know the *sunna* is
  plucking, but I cannot bear the pain." An imam of a school choosing the easier
  permitted method and saying so aloud. The single most useful line in
  `removing-body-hair`, and it is an anecdote, not a ruling.
- **Abu Hanifa's quarter rule** — a lock of hair escaping does not void a
  woman's prayer — is a named classical position, not a concession. It answers a
  question people ask constantly and almost never get answered from a book.
- **'A'isha tearing a sheer khimar off her niece** and saying "it is only drawn
  with **the thick that covers**": a checkable standard for opacity, set by the
  narrator of the verse.
- **Ibn 'Abd al-Barr on Ibn 'Umar's beard**: "he narrated *let the beards grow*,
  and he understood the meaning, and so he used to do what we have described."
  The narrator as his own earliest interpreter — the strongest single argument
  in the trimming dispute, on either side.

### Three questions that turned on a school split, not a text

`can-men-wear-shorts` is about **the knee**, not the thigh: Hanafi in, Shafi'i
out, and al-Sarakhsi and Ibn Qudama run the *same anatomical fact* — the knee is
where the 'awra bone meets the non-'awra bone — to opposite conclusions, one by
precaution and one by definition. `getting-a-tattoo` splits on removal: Ibn
'Abidin identifies the removal-obligatory view as Shafi'i and declines it, on
the ground that a tattoo is a *trace* and not a *substance*. `piercings` splits
on whether there is any warrant at all: al-Ghazali forbids it for want of
evidence, and Ibn Hajar answers him with Ibn 'Abbas's report — after first
dismantling the 'Id hadith that is normally used to prove it.

That last is worth recording as method: **Ibn Hajar attacks the standard proof
before supplying a better one.** An answer that had simply cited the 'Id hadith
would have been citing evidence its own commentator rejected.

### Retrieval

- **A probe typo produced textbook homograph drift.** `is-hijab-obligatory` was
  probed with `وضرب الخمر على الجيوب` — *striking* and *khamr* — instead of
  `وليضربن بخمرهن`. Three of 21 passages came back from the *hadd for drinking*.
  Fixed in `questions.yaml`; the sheet was rich enough elsewhere to use as-is.
  Unlike the section-12 drift, this one was my error and not the corpus's.
- **English abstraction words are the worst probes in the corpus.** "covering",
  "face", "piercing" and "remove" each pulled four to nine unrelated Qur'an
  verses onto their sheets — `فغشاها ما غشى`, `شهاب ثاقب`, `فما استطاعوا له
  نقبا`. Every one scored respectably. The Qur'an-dominance detector from the
  plan would have caught these; the rerank score did not.
- **One drift survived to the reading stage.** `piercings` returned Sunan Ibn
  Majah 2:1051-1052 on `نقص في الاذن` — sacrificial animals with defective ears.
  Caught by reading, not by scoring.
- **`draft.ts prepare` takes exactly one slug.** Extra arguments are silently
  ignored (`scripts/draft.ts:347`). Earlier "batch" invocations in sections 8–13
  produced only their first worksheet; the rest were prepared singly later
  without anyone noticing the difference. Section 14 used an explicit loop.

### One cross-worksheet observation to carry forward

Fath al-Bari 10:308, on the perfume sheet, annexes to the perfume prohibition
"her wearing **the creaking sandal**, and other things that draw the eye towards
her" — a direct classical mention of noisy footwear. It is not on the
`high-heels` worksheet, so `high-heels` could not cite it. **When two questions
are near-twins, check whether the better passage landed on the sibling sheet
before drafting the second.** This is the third time the cross-worksheet twin
problem has appeared; the earlier two were resolved by re-preparing, which was
not worth it here.

### Sections 1–14 and 16 complete — 315/469

---

## Thirteenth addendum — section 21 (du'a, dhikr and spiritual life), 20/20

The section with the widest gap between what the corpus holds and what readers
arrive believing — and the first section in which the *pastoral* shape of an
answer was often decided by a single sentence from a commentator rather than by
the balance of the fiqh.

### A new failure class: cross-worksheet citation confusion

Three errors of a kind not seen in sections 1–16, all caught by `checkQuotes`
before commit, all caused by holding two sibling worksheets in mind at once:

| Slug | What I cited | Where that text actually was |
|---|---|---|
| `how-do-i-repent` | Majmu' al-Fatawa 10:329-331, 11:699-700 | the sibling sheet `same-sin-over-and-over` |
| `same-sin-over-and-over` | al-Qurtubi **4:211** on *israr* | only **4:212** was on that sheet |

This is distinct from the section-14 hazard ("the better passage is on the
sibling sheet"), which is a *retrieval* problem solved by re-preparing. This one
is a drafting problem: sibling questions retrieve overlapping-but-not-identical
passage sets, and the difference is invisible while writing. The fix is
mechanical — `qq.py` maps passage numbers through the worksheet actually being
committed, so a quote from the wrong sheet cannot resolve — but it only fires at
verification time, after the prose is written. **Peek at the sheet again before
writing each sibling, not once for the pair.**

A related slip followed the repair: renumbering citations after removing two left
an inline `[9]` that should have been `[10]`, which `commit` caught as "citation
10 is never referenced in the answer".

### Retrieval: three ways the probes went wrong

**Double homograph.** `فضل الذكر` put 8 of 24 unrelated passages on
`what-is-dhikr` — *fadl* as surplus in inheritance shares, *dhakar* as male. Two
independent homographs in a two-word probe.

**Single homograph, heavy.** `evil-eye-protection` retrieved on عين and got the
eye as organ, the eye in retaliation (*al-'ayn bi-l-'ayn*), *'ayn* as a specific
identified object in fiqh, and washing the eyes in wudu. 12 of 23 passages were
noise; the 9 that landed were enough, and re-preparing was not worth it.

**Drift into a different subject.** `amulets-and-taweez` retrieved on hanging and
on children and returned gold rings, silk for boys, children's testimony, and
greeting children — 6 usable passages of 23. Also enough, because Al-Majmu' 9:66
carries the entire dispute on its own.

The lesson repeated from section 13: **a sheet with few on-target passages is not
a bad sheet if one of them is the right chapter.** Passage count is not evidence
quality.

### The escaped-quote guard, 7th firing

`amulets-and-taweez`, Sunan Abi Dawud 6:31 — the Ibn Mas'ud *tama'im* hadith
carries bare `"` around both the marfu' text and the closing du'a. Split into
three citations at the quote characters. Same fix as the previous six.

Also two more whitespace anchor misses (`أنه لا   يكفر` in Radd al-Muhtar 4:426;
paragraph breaks inside the Tirmidhi dreams hadith), both resolved by
re-anchoring. `checkQuotes` collapses whitespace, so the stored quote is fine.

### OCR artifact found in a source

Sunan al-Nasa'i al-Kubra 6:42-43 has `مل شيء` for `كل شيء`. The same chunk carried
a clean variant of the same hadith (report 9973), which was quoted instead. This
is the first confirmed OCR error found in the corpus by reading rather than by
the audit script — worth noting that the audit's markup check would not catch it,
since `مل` is a valid Arabic string.

### Source-name flags: three cosmetic, none substantive

`commit` flags a named source with no citation behind it. Three fired in this
section and all three were correct-but-cosmetic:

- `amulets-and-taweez` — "al-Bayhaqi", quoted *through* Al-Majmu' 9:66, which the
  prose states and citation [10] carries verbatim (`قال البيهقي هذه الرواية أصح`).
- `black-magic` — "al-Bukhari", named because Ibn Qudama attributes the 'A'isha
  hadith to him inside Al-Mughni 9:34. Prose was rewritten to make the chain
  explicit ("which Ibn Qudama cites from al-Bukhari"); the flag still fires,
  because the check matches the bare name.
- `astrology-and-horoscopes` — "al-Tirmidhi" and "al-Bukhari", appearing as
  *hadith critics* inside the isnad criticism quoted from Al-Majmu' 16:417.

The check cannot distinguish "cited from a work not in the corpus" from
"transmitted by a work that is". Both are legitimate; only the first is a
problem. Leaving all three for the reviewer.

### Findings worth recording

**Fath al-Bari 11:87 settled two answers at once.** Ibn Hajar records a condition
later scholars added to repentance — "that he not return to that sin, for if he
returns, it becomes clear his repentance was void" — attributes it to **al-Qadi
Abu Bakr al-Baqillani**, and refutes it: "the hadith coming twenty chapters later
refutes it." Paired with al-Qurtubi 4:213 ("the first repentance was an act of
obedience, and it concluded and was valid"), this answered both
`how-do-i-repent` and `same-sin-over-and-over`.

**Radd al-Muhtar 1:561 has a dedicated section on du'a in a non-Arabic language**
(`مطلب في الدعاء بغير العربية`) and supplies the entire argument: al-Qarafi's
prohibition, al-Laqani's qualification of it to the case where the meaning is
*unknown*, and Ibn 'Abidin's precise grading — `وظاهر التعليل أن الدعاء بغير العربية
خلاف الأولى، وأن الكراهة فيه تنزيهية`. A reminder that Ibn 'Abidin's `مطلب` headings
are effectively a topical index into the modern-question space.

**Ibn Hajar's tattoo observation** (Fath al-Bari 10:173) answers the blue-bead
question directly, and he flags it as original to him: the hadith pairs "the eye
is real" with the prohibition of tattooing because one motive for tattooing was
to alter appearance so the eye would not strike — "contriving by the tattoo or
anything else that does not rest on the Lawgiver's instruction avails nothing."

**Ibn 'Abd al-Barr on the Sahl b. Hunayf incident** (Al-Tamhid 6:237-238) supplied
the pastoral centre of `evil-eye-protection`: the Prophet ﷺ rebuked 'Amir not
for looking or admiring — "this is not something a person controls in himself" —
but only for abandoning the *tabrik*, "which **was** within his capacity and
power." Admiration is involuntary; the word is not.

### The three-way school split on Qur'anic amulets

`amulets-and-taweez` is the section's one genuinely unsettled question, and the
sources on the sheet argue both sides:

| Position | Evidence |
|---|---|
| permitting a Qur'anic *ta'wiz* | al-Bayhaqi via Al-Majmu' 9:66: no harm for "one who hangs it seeking blessing through the remembrance of Allah in it, knowing that none removes it but Allah"; Abu 'Ubayd restricting the prohibition to non-Arabic of unknown meaning; 'A'isha's timing distinction (before vs. after the affliction) |
| restricting | Ibn Hajar's exception is for what is "by Allah's names and His speech" — but every proof he adduces is *recitation*, not suspension; and 'Uqba b. 'Amir's hadith is unqualified |

The answer states the split rather than resolving it, and rests the practical
advice on an asymmetry rather than a verdict: the disputed act is optional, the
undisputed alternative (recite it) is superior, so nothing is lost by taking it.

### Where the sources fall silent, and the answer says so

`black-magic` asks two questions — is it real, and how would I know I am
affected. The corpus answers the first at length and the second **not at all**:
no symptom list, no test, no diagnostic procedure anywhere in 37 works. This is
the first answer written where the *absence* of evidence is the load-bearing
finding, and stating it plainly is the whole pastoral value: the modern harm in
this area comes almost entirely from misattribution, and the tradition offers no
warrant for the checklists in circulation.

Distinguish this from the section-13 declines (the sources never performed the
classification the modern question requires) and the section-12/16 declines
(jurisdiction). Here the sources *could* have spoken and simply did not.

### Sections 1–14, 16 and 21 complete — 335/469

---

## Fourteenth addendum — section 22 (manners, character and daily life), 20/20

Twenty questions: the greeting, sneezing and yawning, the bathroom, sleep,
entering and leaving the home, lying, oaths and their expiation, promises,
anger, jealousy, foul speech, dogs, other pets, animals generally, smoking,
vaping, neighbours, and seeking knowledge. Adab is the section where the hadith
corpus is richest and the fiqh works thinnest, and the drafting reflected that:
more citations per answer came from the *Sunan* works here than in any prior
section, and several answers rest on a single fiqh gloss placed against four or
five hadith.

### A new failure class — precomposed versus decomposed Arabic

`how-to-give-salam` citation 4 (Qur'an 4:86) failed `checkQuotes` while looking,
on screen, exactly like the stored text. The cause is Unicode normalisation, and
it is worth recording precisely because nothing about it is visible.

The stored chunk holds the word as base letter + **combining maddah** (U+0653).
The copy I had typed from the peek output used the **precomposed** form `آ`
(U+0622). The normaliser in `web/lib/draftFormat.ts:82` strips marks
(`\p{Mn}`) but keeps letters — so the stored text loses its maddah and the typed
text keeps its alif-madda, and the two normalise to different strings.

```
stored :  ا + U+0653   → normalises to  ا
typed  :  U+0622 آ      → normalises to  آ
```

Two consequences. First, a quote can be *character-for-character wrong* while
being *pixel-for-pixel right*, so proofreading cannot catch this class at all —
only the checker can. Second, the fix is procedural, not textual: since this
firing, **every Arabic quote has been extracted programmatically from the chunk
by anchor pair, never retyped**, including short Qur'anic phrases where typing
would have been quicker. That rule now covers the whole remaining bank.

This joins the escaped-quote guard as the second failure that the eye cannot
see. The escaped-quote guard fired four more times in this section —
`amulets-and-taweez` (Abu Dawud 6:31, the Ibn Mas'ud *tama'im* hadith),
`sneezing-and-yawning` (Musnad Ahmad 39:274-276, Salim b. 'Ubayd),
`entering-and-leaving-home` (Ibn Majah 2:1278-1280, the two angels), and
`sleeping-etiquette` (Muslim 4:2085, al-Bara's correction) — bringing it to
eleven firings overall. The pattern is stable: it fires on **narrations
containing reported speech**, because the digitisation marks direct speech with
bare `"` characters. Adab sections are unusually dense in reported speech, which
is why four of eleven firings fall in one section of twenty questions.

### A retrieval failure that SQL can see and the retriever cannot

`is-smoking-haram` is the clearest instance yet of a gap that is not a corpus
gap. The corpus **does** contain a substantive tobacco ruling:

| Location | Content |
|---|---|
| Radd al-Muhtar 2:434 (chunk 456291) | al-Shurunbulali's verse: `ويمنع من بيع الدخان وشربه * وشاربه في الصوم لا شك يفطر` |
| Radd al-Muhtar 1:10 | places smoking with garlic and onion (malodorous) rather than under `استعمال محرم` |

Both are findable in one `select ... where content like '%الدخان%'`. Neither is
reachable by the hybrid retriever — not by the question, not by the glossary
probes, and not by a probe quoting the verse nearly verbatim.

The reason is chunk composition, not embedding quality. The tobacco sentence is
a **short fragment inside a long chunk whose subject is forgetting while
fasting**. The chunk embedding is a summary of the whole chunk, so it sits in
the fasting region of the space; a tobacco query lands nowhere near it, and the
lexical arm cannot rescue it because the surrounding thousands of characters
dilute the term frequency of the one word that matters.

This is a different diagnosis from the two failure modes recorded earlier:

- **Vocabulary gap** (section 1, the *masah* case) — the corpus speaks of the
  thing under a name the query does not use. Fixed by the glossary.
- **Homograph drift** (sections 12, 21) — the probe term carries two senses and
  retrieval follows the wrong one. Fixed by lengthening the probe.
- **Fragment-in-a-long-chunk** (here) — the passage exists, is correctly
  indexed, and is unreachable at any probe phrasing, because the unit of
  retrieval is larger than the unit of relevance.

Only the third is unfixable by prompting. It is fixable by re-chunking, which
would mean a re-ingest of the whole corpus, and it is fixable at query time by
adding a targeted lexical arm that scores rare-term hits without length
normalisation. Neither is worth doing for a single ruling; both are worth
remembering when the miss log accumulates. The answer was written on the general
principle instead — intoxicants, `khaba'ith`, and harm to the body — with the
Hanafi hesitancy noted, which is what the reachable evidence supports.

`vaping` inherits the same gap and was written from the same principle, with one
addition of its own: **Abu Ayyub al-Ansari** (Nasa'i al-Kubra 6:298-299)
restricts *"do not cast yourselves into ruin"* (2:195) to the Ansar's private
wish to stay home and tend their property. That is the verse most often produced
in modern arguments about smoking and it does not, on its earliest reported
reading, mean what those arguments need it to mean. Recorded here as a caution:
the strongest-sounding proof-text in a modern debate is the one most worth
checking against the tafsir.

### A worksheet that duplicated its neighbour

`keeping-pets` was prepared, drafted, and then discarded. Its passages were very
nearly the passage set of `keeping-a-dog` — the two questions are close enough
in English that the query embeddings landed in the same place, and the dog
material is far denser in the fiqh works than the general-pet material, so it
dominated both.

Re-prepared with probes aimed away from dogs (`سؤر الهرة`, `حبس الطير`,
`أبو عمير`), the sheet returned what the question actually needed:

- **Al-Tamhid 1:319-323** — the cat is not impure, `إنها من الطوافين عليكم
  والطوافات`, with Malik's reasoning on necessity of contact.
- The **Abu 'Umayr** material on the child's *nughayr*, with al-Qurtubi's
  resolution against reading it as abrogated.

The lesson generalises: **when two slugs in a section are near-synonyms in
English, check the second sheet against the first before drafting.** A duplicate
worksheet does not announce itself — every passage on it is real, relevant, and
correctly cited; it is simply the wrong question's evidence. This is now the
second time a silent whole-question failure has come from retrieval landing
plausibly rather than correctly (the first was the glossary bug on `riba`).

### Findings worth keeping

**Radd al-Muhtar 6:736 — the written salam.** Ibn 'Abidin treats a salam sent in
writing as obliging a reply just as a spoken one does, and cites the verse
`إذا كتب الخليل إلى الخليل * فحق واجب رد الجواب`. This is the pre-modern text
that speaks most directly to a message left unanswered on a phone, and it does
so without any analogy being invented for it.

**Ibn 'Abidin 6:749-750, transmitting al-Ghazali — the test for permitted
lying.** If the aim can be reached by truth *and* by lying, lying is forbidden;
only where the aim is reachable by lying alone is it permitted, and where the
aim is itself obligatory, the lie becomes obligatory. This converts the three
famous exceptions from a list to be memorised into a criterion that can be
applied, and it sets the bar high enough that most of what people justify under
"the three exceptions" fails it.

**Fath al-Bari 5:213 — Ibn Hajar's father on the broken promise.** "Breaking it
is forbidden while fulfilling it is not obligatory — that is, he sins by
breaking it, even if he is not compelled to fulfil it." A precise statement of an
asymmetry that most English treatments of promises blur.

**Anger: three complementary readings.** al-Khattabi — anger itself cannot be
forbidden, being part of the constitution; Ibn Hibban — the command in
`لا تغضب` is a command not to *act on* it; al-Tufi — the remedy is a matter of
tawhid, since the one who sees the decree as God's does not rage against it.
Together these let the answer say what "do not be angry" asks of a person
without asking the impossible of them.

**Al-Sarakhsi's three-part test for hasad against ghibta** — to wish the
blessing removed, to exert oneself toward its removal, and to believe it wrongly
placed. Useful precisely because ordinary envy usually fails the second and
third parts, so the answer can tell a reader what they are actually experiencing.

**Al-Nawawi on the dog.** The "sounder view" is that the operative cause is
**need**, not the species — which opens guard, herding, guide and service dogs
directly, rather than by exception. The purity question then splits four ways,
with Malik, al-Awza'i and Dawud holding the leftover pure; the answer reports the
split rather than resolving it.

**Radd al-Muhtar 1:45 — the fard 'ayn list.** A concrete enumeration rather than
an exhortation: the five obligations, sincerity, halal and haram, riya', envy and
self-admiration, the rules of whatever trade or marriage one has actually entered
into, and the expressions that entail disbelief. **Four of the seven are
knowledge of the heart.** For `seeking-knowledge` this is the whole answer: the
question "what am I obliged to learn" has a printed answer, and most of it is not
about ritual mechanics.

### Cross-worksheet citation confusion — no further instances

The failure recorded in the thirteenth addendum — a citation numbered against
the wrong worksheet's passage map — did not recur, and the `qq.py` map-then-write
discipline appears to have closed it. One near-miss of a different kind occurred
in `astrology-and-horoscopes`: inserting a new citation `[2]` and then running
the bulk renumber bumped the newly inserted marker as well, leaving two `[3]`s.
Caught by reading the rendered answer, not by any checker. **Renumbering must be
done before insertion, or the inserted marker must be excluded from the loop.**

### Sections 1–14, 16, 21 and 22 complete — 354/469

---

## Fifteenth addendum — section 18 (technology, media and entertainment), 15/15

The section where the corpus is furthest from the question and, unexpectedly, most
useful. Fifteen questions: music, singing, instruments, film, photographs, posting
photographs, drawing, video games, online conduct, backbiting online, AI, wasted
time, dancing, sport, and board games. Only four of the fifteen have a subject the
sources address directly — singing, instruments, images and games of chance.
Everything else had to be answered by taking a principle the jurists stated and
saying plainly where it does and does not reach.

### The retrieval story: nine questions had no probes at all

Section 18 arrived with 5 of 15 questions carrying `also_retrieve` and 10 carrying
none, the thinnest coverage of any section drafted so far. Before preparing, nine
questions were given three Arabic probes each and four thin ones were extended.
The probes did the work the English questions could not:

| Question | Probe that landed it |
|---|---|
| `watching-films-and-tv` | `مجالس اللهو والمنكر وحكم حضورها` → al-Jassas 3:278, the whole framework |
| `wasting-time-on-phone` | `نعمتان مغبون فيهما كثير من الناس الصحة والفراغ` → Fath al-Bari 11:196-197 |
| `is-ai-use-allowed` | `شروط المفتي وأدب الاستفتاء` → **Adab al-Mufti wa'l-Mustafti**, twice |
| `chess-and-card-games` | `حكم اللعب بالشطرنج` → Al-Tamhid 13:176-184, the fifteen-name roster |
| `video-games` | `الرهان والسبق والعوض في اللعب` → Bada'i' 6:206, the *muhallil* rule |
| `sports-and-exercise` | `علموا أبناءكم السباحة والرمي` → Nasa'i 5:302-303, the four-item version |

The `is-ai-use-allowed` case is the clearest demonstration yet that **the probe is
the answer**. The English question retrieves nothing — the corpus has no concept to
match. A probe about the *conditions of a mufti* retrieves Ibn al-Salah, whose list
of qualifications turns out to be the precise ground on which the question can be
declined with evidence rather than with a shrug.

### The near-duplicate problem, recognised in advance and once unavoidable

The thirteenth addendum recorded `keeping-pets` duplicating `keeping-a-dog`. Section
18 contains three questions that share a subject — `photographs-and-selfies`,
`posting-photos-on-social-media`, `drawing-and-art` — and two more —
`is-music-haram`, `is-singing-allowed`, `musical-instruments`.

The image trio was checked before drafting. `photographs-and-selfies` and
`drawing-and-art` retrieved substantially the same passages, and this time that was
**correct**: drawing by hand is what the *taswir* material is actually about, and the
photography answer is the derivative one. The fix was not re-retrieval but a
deliberate split of angle — the photography answer leads on the fact that no source
describes a camera, and the drawing answer leads on what is open (everything not
ensouled) before what is disputed.

`posting-photos-on-social-media`, whose probes had been extended with
`الرخصة في الصور الممتهنة كالبساط والوسادة`, came back genuinely different: **Al-Mabsut
1:211** and **Tafsir al-Qurtubi 16:327**, neither of which appeared on the other two
sheets. Al-Sarakhsi's repeated operative phrase `معنى التعظيم` — whether the sense of
veneration is present — turns out to be the most transferable idea in the whole
image file, and it reached the sheet only because the probe named the *licence* rather
than the prohibition.

**Rule confirmed:** when a section contains near-synonymous slugs, probe the second
one toward the part of the file the first one will not reach. Probing toward the
same target produces the same sheet.

### The music trio: how to report a dispute without settling it

`questions.yaml` flags all three with a note that retrieval leans prohibitive
"because that is what the corpus holds", and that the answer must present the range.
Three findings made this possible without special pleading:

**Ibn 'Abd al-Barr states which side has the stronger chains.** Al-Tamhid 22:199:
having gathered every prohibitive report, he writes `وقد أتى ما هو أثبت من هذا من جهة
الإسناد في خصوص الرخصة` — what has come regarding the licence is *firmer in chain*.
A hadith master, on the prohibitive side of the argument, conceding the weight of
the evidence. Nothing else in the file does as much work.

**Ibn Hajar reports consensus claimed in both directions.** Fath al-Bari 2:368:
`وقد حكى قوم الإجماع على تحريمها وحكى بعضهم عكسه`. When both a consensus and its
negation are transmitted, the honest report is "majority", not "settled".

**Ibn Taymiyya concedes the dispute while arguing against it.** Majmu' 27:229-230
lists listening to singing and instruments among matters `للناس فيه قولان التحريم
والإباحة`. The strictest authority in the file supplies the sentence that makes a
balanced answer possible.

Set against these, the *ma'azif* hadith and al-Tabari's claimed consensus (which
names its own two dissenters) are reported at full strength. The three answers land
differently from one another — voice permitted with a named minority dissenting,
instruments genuinely contested, the general question mapped rather than ruled —
and that is the shape of the file, not a compromise imposed on it.

### The most useful single sentences found in this section

**Ibn 'Abd al-Barr on quantity and prohibition** (Al-Tamhid 13:182-184), on the
Maliki rule that occasional private chess is pardoned: `وهو يدلك على أنه ليس بمحرم
لنفسه وعينه لأنه لو كان كذلك لاستوى قليله وكثيره في تحريمه` — *this shows you that it is
not forbidden in itself, because if it were, its little and its much would be equal
in prohibition.* A general test for distinguishing a rule about an object from a
rule about a behaviour, and applicable far beyond chess.

**Bada'i' al-Sana'i' 6:206 on why the racing exception exists:**
`ولئن كان لعبا لكن اللعب إذا تعلقت به عاقبة حميدة لا يكون حراما` — *play to which a
praiseworthy outcome attaches is not forbidden.* This is the sentence that lets a
question about video games be answered on principle rather than by refusal.

**Al-Jassas 3:278 on when to leave a gathering.** Moving away from a wrong is better
— *provided* it does not mean abandoning a duty: congregational prayer, a funeral, a
wedding feast. Illustrated by Abu Hanifa (`لقد ابتليت به مرة` — I was tested with it
once) and by al-Hasan and Ibn Sirin at the same funeral doing opposite things,
neither censured, with al-Hasan's `إنا كنا متى رأينا باطلا وتركنا حقا أسرع ذلك في ديننا`.
The most humane page in this section of the corpus.

**Ibn Taymiyya's catalogue of the disguises of backbiting** (Majmu' 28:237-238):
six moulds — piety, the humble-brag, mockery, astonishment, feigned concern, and
righteous anger — each one a recognisable genre of Muslim internet post. It is
descriptive rather than juridical, and it is the single most directly transferable
passage found in the whole bank so far.

**Ibn Hajar on talebearing** (Fath al-Bari 10:394):
`حتى لو رأى شخصا يخفى ما له فأفشى كان نميمة` — *even if he saw someone concealing his
wealth and disclosed it, that would be talebearing.* Not a lie, not an insult:
merely making public what someone kept private. The classical name for a screenshot.

**Ibn al-Salah's conditions for a mufti** (Adab al-Mufti 1:210): Muslim, trustworthy,
reliable, clear of what forfeits propriety, of jurist's instinct, sound of mind,
weighty in thought, correct in derivation, alert. Every item is a predicate of a
*person*. This is the evidential ground for declining `is-ai-use-allowed` — not that
a machine is forbidden, but that it is not the kind of thing the tradition ever
imagined asking. Paired with the Baghdad *tashif* story from the same work (a
divorce ruled on from a misparsed unpointed question), it is a nine-hundred-year-old
description of what goes wrong when a religious question is answered from text alone.

### Two procedural notes

**The escaped-quote guard fired a twelfth time** — `backbiting-online`, on the
*ghiba* hadith in Sunan Abi Dawud 7:237, whose reported speech is marked with bare
`"`. Split into two spans. The pattern recorded in the fourteenth addendum holds
exactly: it fires on narrations containing direct speech.

**One cosmetic source-name flag was accepted rather than fixed.** `musical-instruments`
commits with `hadith: Bukhari` flagged, because the name appears only inside the
faithful English rendering of citation [1] — Ibn Taymiyya naming his own source for
the *ma'azif* hadith. Rewording to satisfy the checker made the translation less
faithful, which is the wrong trade: the checker exists to catch *unbacked* source
claims, and this one is backed by the citation it sits in. Two earlier flags on
`is-music-haram` (Luqman 31:6, Tirmidhi) were genuine and were fixed by removing
the bare references from prose.

### A note on what this section is for

Ten of these fifteen questions have no ruling in the corpus. The temptation in every
one of them is to supply the missing ruling by analogy and present it as the
tradition's. The discipline adopted throughout was to say, in the answer's own first
paragraph, that the sources do not address the case — and then to give the reader the
reasoning the jurists actually used, marked as reasoning, so that they can see where
the extension is being made and by whom. `photographs-and-selfies` and
`watching-films-and-tv` both name the point at which the analogy stops holding.
`is-ai-use-allowed` declines outright and says why, at length, with evidence.

That is the only honest way to answer a question the corpus cannot, and it should be
the pattern for **17. Money and work** and **23. Health and medicine**, where the same
problem arrives at much higher stakes.

### Sections 1–14, 16, 18, 21 and 22 complete — 369/469

---

## Sixteenth addendum — section 19 (social life and other religions), 16/16

The section a revert needs most and the one where a careless answer does the most
damage. Sixteen questions covering friendship, the pub, Christmas dinner,
congratulations, gifts in both directions, birthdays, Mother's Day, New Year,
weddings, funerals, churches, greetings, explaining Islam, other religions, and
hostility. Fifteen of the sixteen arrived with **no `also_retrieve` at all** —
the thinnest coverage of any section so far, thinner even than section 18 — and
`friends-who-arent-muslim` carried the only existing probes together with a note
warning that without them the retrieved set is one-sided.

### The note on `friends-who-arent-muslim` was right, and the fix is reusable

That note says the question returns only the verses about not taking allies unless
probed. That is exactly what happens, and the probe
`لا ينهاكم الله عن الذين لم يقاتلوكم في الدين` brings back the answer:

**Tafsir al-Tabari 22:571-574 and 22:573-574.** Al-Tabari takes 60:8 as covering
`من جميع أصناف الملل والأديان` — all classes of creeds and religions — and then
disposes of the abrogation claim in terms:
`ولا معنى لقول من قال: ذلك منسوخ` — *there is no meaning to the statement of one who
said that is abrogated* — because kindness even to someone of a hostile people is
not forbidden, **so long as it does not disclose a vulnerability of the Muslims or
strengthen them with mounts or weapons**. A prohibition about espionage and arms,
not about friendship.

He also preserves the occasion: Asma' bint Abi Bakr refusing her own mother at the
door until the Prophet gave leave, and the verse coming down to correct *her
caution*. That single report answers the question a new Muslim is actually asking,
and it is unreachable from the English question alone.

**Recorded as a general finding:** where a question has a hard verse and a soft
verse on the same subject, the English phrasing retrieves the hard one, because it
is the one that circulates. The probe has to name the soft one explicitly. This
will matter again for section 15 (family) and section 24 (hard questions).

### Two retrieval failures, both from chunk boundaries rather than absence

**`new-year-celebrations` retrieved nothing usable on the first pass.** Probes
about `النيروز والمهرجان` landed on contract-deadline law and fasting rules — the
corpus's *nayruz* material is overwhelmingly about when a sale term falls due, not
about festivals. Re-probed with the *text of the ruling itself*
(`لا يحل للمسلمين أن يتشبهوا بهم في شيء مما يختص بأعيادهم`) and it returned Majmu'
al-Fatawa 25:329-331 and 25:331-332 immediately.

**`going-into-a-church` needed three passes.** The first two retrieved
Majmu' al-Fatawa 22:162, which is *the question put to Ibn Taymiyya* — a chunk
containing only `هل الصلاة في البيع والكنائس جائزة مع وجود الصور أم لا` — while the
answer sits in the next chunk, 22:162-163, which the retriever never reached. The
probe matched the question because the question is phrased like a question.

This is a **new variant of the fragment-in-a-long-chunk failure** recorded in the
fourteenth addendum, and in some ways a worse one: the retrieved chunk is on the
exact topic, scores well, and contains no information. A survey of the worksheet
shows a plausible source at a plausible reference, and only reading the passage
reveals that it is an empty shell.

It was resolved by probing with the text of a *different* work's ruling
(`لا بأس بالصلاة في الكنيسة النظيفة`), which brought back **Al-Mughni 1:407-408** —
a better source for the answer in any case, since it names the permitting
authorities (al-Hasan, 'Umar b. 'Abd al-'Aziz, al-Sha'bi, al-Awza'i, Sa'id b. 'Abd
al-'Aziz, and 'Umar and Abu Musa) and states the dissent (Ibn 'Abbas and Malik)
with its reason (`من أجل الصور` — on account of the images).

**Rule added:** when a `PARATEXT ... وسئل` chunk comes back, check whether it is the
question or the answer before drafting from it. Fatwa collections in this corpus
are chunked such that the two can separate.

### A numbering slip worth recording

`mothers-day` failed `checkQuotes` on three citations because **two passages on the
same worksheet carry the same printed reference** — Sahih Muslim 4:1976 appears as
both Passage 13 and Passage 17, on different chunks. Drafting from the peek output,
which shows the reference and not the chunk, I assumed the lower passage number held
the earlier chunk. It did not.

This is the second instance of passage/chunk confusion (the first was the
cross-worksheet case in the thirteenth addendum), and it has the same character:
the error is invisible in the prose and caught only by the checker. **When a
worksheet lists one reference twice, map passage number to chunk id explicitly
before writing any citation.**

### The best finds in the section

**Al-Mughni 1:407-408 — praying in a church.** The jurists' question was never
whether a Muslim may *enter* one; it was whether he may *pray* there, and the
majority said yes. The dissent (Malik, Ibn 'Abbas) turns on images, which is a rule
that would apply equally to a Muslim's living room. Ibn Qudama's argument is that
the Prophet ﷺ prayed in the Ka'ba while images were in it, and that
`فأينما أدركتك الصلاة فصل، فإنه مسجد`.

**Fath al-Bari 3:144 — standing for a Jew's funeral.** The chapter heading is
`باب من قام لجنازة يهودي`, and the Prophet's answer to the objection is
`أليست نفسا` — *is it not a soul?* Al-Qurtubi's inference:
`فمن ثم استوى فيه كون الميت مسلما أو غير مسلم`.

**Al-Majmu' 5:142-144 — burying a non-Muslim.** Not obligatory to wash him,
expressly permitted to do so, his own relatives having the prior claim; and on
shrouding and burial of a *dhimmi* who leaves no wealth, the sounder view is that it
falls on the Muslims — `وفاء بذمته كما يجب اطعامه وكسوته في حياته`. A Muslim
community obliged to bury, at its own cost, someone who died outside its religion.

**Al-Tamhid 17:91-92 and Tafsir al-Qurtubi 11:112 — initiating the salam.** A far
wider spread than the single prohibitive hadith suggests. **Abu Umama al-Bahili**
greeted everyone he met, Muslim or protected person, saying it is
`تحية لأهل ملتنا وأمان لأهل ذمتنا واسم من أسماء الله نفشيه بيننا`. **Ibn Mas'ud**
wrote *peace be upon you* to a man of the People of the Book and said
`لو قال لي فرعون خيرا لرددت عليه مثله`. **Malik's position is 'Umar b. 'Abd
al-'Aziz's**, and Ibn Wahb permitted it. Al-Nakha'i confines the prohibition to
where there is no reason: `أو حق صحبة أو جوار أو سفر` — a right of companionship,
of neighbourliness, or of travel. And Ibn 'Abd al-Barr's own reconciliation:
`ليس عليكم أن تبدؤهم` — it is not *incumbent* on you, and on that reading
`ارتفع الاختلاف`.

Al-Awza'i's answer to the same question is the most generous sentence in the
section: `إن سلمت فقد سلم الصالحون قبلك وإن تركت فقد ترك الصالحون قبلك`.

**Fatawa Qadi Khan 3:359-360 — ambiguity is not a creed.** In a chapter listing
expressions that entail disbelief, al-Natifi's rule:
`إذا أطلق وقال لا أصلي لا يكفر لأن هذا اللفظ محتمل` — an unqualified, ambiguous
expression is not construed as disbelief, even one as alarming as *I will not pray*.
This is the Hanafis' own method of interpretation, and it is what makes a
non-committal answer on *saying-merry-christmas* defensible rather than evasive.

**Radd al-Muhtar 2:412-413 — the singling-out principle.** Fasting deliberately on
*nayruz* is disliked because it resembles glorifying the day; fast a second day with
it and the dislike lifts, `لأنه لم يعظم أحد منهم هذين اليومين معا`. The objection
attaches to **singling the day out in a way that constitutes glorifying it** — which
transfers cleanly to a family dinner that happens to fall on a date.

**Al-Tamhid 2:12-13 and Al-Fatawa al-Hindiyya 5:347 — the conflicting gift reports.**
Both works set out the contradiction between the Prophet ﷺ accepting gifts (from
Ukaydir, Farwa b. Nufatha, al-Muqawqis) and refusing them (`إنا لن نقبل هدية مشرك`),
and both reconcile it situationally rather than by a general rule. Ibn 'Abd al-Barr
gives three readings, including that he declined only because
`كان من خلقه أن يثيب على الهدية بأحسن منها`; al-Hinduwani reads the refusal as
confined to a giver who believed the Prophet fought for money. None of the four
reconciliations reaches a wrapped box in December.

### On the two questions this section could not settle

`saying-merry-christmas` and `celebrating-birthdays` are both answered without a
ruling, and deliberately. The corpus rules on **attending** another religion's
festival and on **eating what was slaughtered for it**; it does not rule on a verbal
greeting or on a birthday, and no amount of probing produces a text that does. Each
answer says so in its first paragraph, gives the prohibitive material at full
strength, gives the interpretive principle that cuts the other way, names the
scholarly position that would forbid it, and stops.

That is the pattern established in section 18 and it held here under more pressure,
because these two questions are ones people expect a confident answer to. Producing
one would have meant presenting an inference as the tradition's ruling — which is
the specific failure this whole bank exists to avoid.

### Sections 1–14, 16, 18, 19, 21 and 22 complete — 384/469

---

## Seventeenth addendum — section 15, family and parents, 14/14

Section 15 closes the bank at **398/469**. Fourteen questions, all fourteen
worksheets prepared before drafting began, and — as in sections 18 and 19 — all
fourteen with no `also_retrieve` probes at the outset. Probes were written for
every one before preparation. That is now three consecutive sections where the
absence of probes was the dominant structural problem, and where writing Arabic
probes first was the highest-leverage single step.

Nothing in this section produced a new *class* of retrieval failure. What it
produced instead was a new class of **drafting** failure, and one correction to
the question bank itself.

### The `expect: decline` flag was wrong, and the flag is not evidence

`inheriting-from-non-muslim-parents` was carried in `questions.yaml` with
`expect: decline` and the note *"Turns on the estate, the jurisdiction and the
school. Refer."* The worksheet contradicted that in its first ten passages. The
corpus answers the classical question with unusual completeness:

- the Usama hadith (Sunan Abi Dawud 4:535-536, Musnad Ahmad 36:77-86),
- consensus one way and near-consensus the other (Al-Minhaj 11:52,
  Al-Mughni 6:246, Al-Tamhid 9:164-165),
- the *named dissent* — Mu'adh b. Jabal, Mu'awiya, Sa'id b. al-Musayyab,
  Masruq — with Ibn Hajar recording Mu'adh actually deciding a case on it
  (Fath al-Bari 12:43: two brothers, one Muslim and one Jewish, their father
  dead a Jew),
- three answers to that dissent, from three different angles — Ibn Hajar's
  *"an analogy set against an explicit text, and there is no analogy where a
  text is present"*, al-Jassas's citation of Masruq calling Mu'awiya's ruling
  *"a newly introduced decision in Islam"*, and al-Nawawi's much gentler
  *"perhaps this group had not received this hadith"*,
- a third position turning on whether the estate has been divided, from 'Umar,
  'Uthman, 'Ikrima, al-Hasan, Jabir b. Zayd and one narration from Ahmad,
- and — the find of the section — **Al-Hidaya 4:233-234**, that a bequest
  crosses the line inheritance cannot: `ويجوز أن يوصي المسلم للكافر والكافر
  للمسلم`, reasoned from 60:8 on one side and from the lawfulness of lifetime
  transfers on the other, *"so likewise after death"*.

The `decline` was right about one half — probate files, intestacy statutes,
pension nominations and joint accounts are twentieth-century instruments the
corpus never contemplated — and wrong about the other. The answer was written
as both: the classical rule stated fully, the *irth*/*wasiyya* distinction given
as the shape of the question, and the jurisdiction-dependent part referred.

**Rule taken from this: a `decline` flag is a prior, not a finding.** It records
what someone expected before the worksheet existed. Read the passages before
honouring it. The reverse case is the one already recorded in earlier addenda —
a question flagged tier A whose worksheet cannot support an answer — and the
discipline is the same in both directions: the sheet decides, not the label.

### The genuinely new failure: assuming the answer must be one thing

`cutting-off-toxic-family` and `keeping-family-ties` draw on overlapping
worksheets (Al-Minhaj 16:112-113 and Fath al-Bari 10:348 appear on both). The
temptation was to write the same answer twice. What separated them was noticing
that the *sila* material contains two distinct things that are usually welded
together in English answers:

1. **The ideal**, which is very high — `ليس الواصل بالمكافئ ولكن الواصل الذي
   إذا انقطعت رحمه وصلها`, and 'Umar's `ليس الواصل أن تصل من وصلك ذلك القصاص`.
2. **The floor**, which is very low, and which almost never gets quoted.

The floor is Qadi 'Iyad via al-Nawawi (Al-Minhaj 16:113) and it is the single
most useful sentence found in this section:

> `ولكن الصلة درجات بعضها أرفع من بعض وأدناها ترك المهاجرة وصلتها بالكلام ولو
> بالسلام ويختلف ذلك باختلاف القدرة والحاجة فمنها واجب ومنها مستحب لو وصل بعض
> الصلة ولم يصل غايتها لا يسمى قاطعا`

Three things in one sentence: the minimum is not shunning plus contact by
speech *even if only a greeting*; it varies with capacity and need; and a
partial tie is still a tie — such a person *"is not called a cutter"*.

Ibn Hajar reaches the same conclusion from the other end (Fath al-Bari 10:355):
`لا يلزم من نفى الوصل ثبوت القطع فهم ثلاث درجات مواصل ومكافئ وقاطع`. Failing
to reach the highest degree is not falling into the lowest. And al-Nawawi's
first reading of *no cutter enters Paradise* is conditioned on `بلا سبب ولا
شبهة` — without cause.

So the two answers split cleanly: `cutting-off-toxic-family` on the floor and
the three degrees, `keeping-family-ties` on the content of the duty. For the
latter the anchor is Ibn Abi Jamra, quoted by Ibn Hajar on the same page:

> `تكون صلة الرحم بالمال وبالعون على الحاجة وبدفع الضرر وبطلاقة الوجه وبالدعاء
> والمعنى الجامع إيصال ما أمكن من الخير ودفع ما أمكن من الشر بحسب الطاقة`

Five named acts — wealth, help with a need, warding off harm, a cheerful face,
supplication — and the limiting clause *bi-hasab al-taqa* built into the
definition rather than bolted on as an exception.

**Rule taken from this: when two questions share a worksheet, find the two
different things the passages say before writing either.** The overlap is a
signal that the sources make a distinction the question bank has split across
two slugs — not that one answer will serve twice.

### What was left unanswered on purpose

Four answers state a limit explicitly, and each names what is missing rather
than gesturing at it:

- `cutting-off-toxic-family` — **nothing on the sheet addresses abuse.** No
  passage on violence, coercion, or a relative who is a danger. Recorded as
  silence, explicitly not as permission or prohibition.
- `raising-children-muslim` — no passage on a mixed household as such: what to
  tell a child who asks why their parents differ, what to do about the other
  parent's observances, how to handle open disagreement.
- `adoption-in-islam` — nothing on court orders, reissued birth certificates,
  surnames, inheritance for an adopted child, or whether milk-kinship is used
  to resolve *mahram* status. The last one has a well-developed classical
  answer that is simply not on this worksheet.
- `non-muslim-parent-died` — the funeral itself beyond 'Ata's reading: whether
  you attend, whether you may help wash or bury, what to do at a service in a
  church or crematorium.

### The hardest question in the section

`non-muslim-parent-died` took the longest and needed the most passages ruled
*out* before anything could be written. Five promising-looking passages were
dumped and discarded — Sahih Muslim 4:2001 (merit of pardon, not the
grave-visit hadith), Sahih al-Bukhari 5:163 (fear prayer), Fath al-Bari 11:390
(the gathering at the Fire), Musnad Ahmad 30:523-527 (handshakes), Al-Tamhid
19:41-42 (a lexical discussion of *salat*). The grave-visit hadith
(`استأذنت ربي أن أزور قبر أمي`) is not on the sheet at all, which was verified
by grep before drafting rather than assumed.

What carried it:

- **Tafsir al-Tabari 12:19-21** — `من بعد ما ماتوا على شركهم بالله وعبادة
  الأوثان`, establishing that death is the trigger;
- **Tafsir al-Tabari 12:29-31** — Qatada's `تبين له حين مات، وعلم أن التوبة قد
  انقطعت عنه`, al-Dahhak's four-word `إذا ماتوا مشركين`, and the most personal
  line in the section, Abu Hurayra drawing the boundary through his own family:
  `رحم الله رجلا استغفر لأبي هريرة ولأمه قلت: ولأبيه؟ قال: لا إن أبي مات وهو
  مشرك`;
- **Fath al-Bari 8:384** — Ibn 'Abbas through a chain Ibn Hajar grades sound:
  `استغفر له ما كان حيا فلما مات أمسك`;
- **Tafsir al-Qurtubi 8:273** — three things at once: the hard statement
  `قطع موالاة الكفار حيهم وميتهم`; **'Ata' b. Abi Rabah** reading the verse as
  covering the funeral prayer, `الآية في النهي عن الصلاة على المشركين
  والاستغفار هنا يراد به الصلاة` — the sheet's only direct statement on the
  funeral; and the hinge that connects this answer to its sibling,
  `الاستغفار للأحياء جائز لأنه مرجو إيمانهم`.

That last clause is why `can-i-make-dua-for-non-muslim-family` and
`non-muslim-parent-died` were deliberately drafted as a pair — the living half
and the dead half — with the dividing line named in both.

One further passage was used with a caveat stated in the answer itself:
Fath al-Bari 8:257's `رعاية الحي المطيع بالاحسان إلى الميت العاصي`. The
surrounding chunk was read (and the preceding chunk 358354 dumped) to confirm
the *fawa'id* belong to the 'Abdullah b. Ubayy incident — and the same page
notes `أن المنافق تجري عليه أحكام الاسلام الظاهرة`. The answer says so: the
case does not transfer as a ruling, and it is cited only for what it shows
about the register, not as licence.

### Other findings worth keeping

- **Fath al-Bari 10:337 vs Tafsir al-Qurtubi 10:239** — a clean case of two
  scholars handling the same claimed consensus differently. Al-Qurtubi accepts
  al-Muhasibi's claim that the mother has three-quarters of *birr*; Ibn Hajar
  reports the same and refuses it: `لكن نقل الحرث المحاسبي الاجماع على تفضيل
  الام في البر وفيه نظر`, then produces Malik's `أطع أباك ولا تعص أمك` against
  al-Layth's `أطع أمك فإن لها ثلثي البر` on the identical question. The ranking
  is certain; the fractions are not. Used in `rights-of-parents`.
- **Ahkam al-Qur'an (al-Jassas) 3:156** — finally used, in `rights-of-parents`.
  Three things: `لا طاعة لمخلوق في معصية الخالق`; the precise scope of the
  parental veto (obligatory military service needs their leave, *trade does
  not*, and the reasoning names what the right protects — `فجيعة الأبوين به`);
  and the line flagged as unused in the fourteenth addendum, `في المسلم يموت
  أبواه وهما كافران أنه يغسلهما ويتبعهما ويدفنهما`. It sits on the
  `rights-of-parents` worksheet, not on `non-muslim-parent-died`'s — so it
  answers the funeral question there and could not be borrowed for the sibling.
  A clean illustration of the never-cite-off-sheet rule costing something real.
- **Sunan Abi Dawud 4:457-459** — Abu Dawud annotating his own narration:
  `خولف همام في هذا الكلام، هو وهم من همام` and `وليس يؤخذ بهذا`, on the
  *yudamma*/*yusamma* variant in the '*aqiqa* hadith. Paired in the answer with
  al-Nawawi's report that the *jahiliyya* blood-smearing was replaced with
  perfume. The best single demonstration in the bank of a compiler correcting
  his own book.
- **Sahih al-Bukhari 2:242** — al-Rubayyi' bint Mu'awwidh on fasting small
  children: `ونجعل لهم اللعبة من العهن فإذا بكى أحدهم على الطعام أعطيناه ذاك
  حتى يكون عند الافطار`. A wool toy for a crying child. The most humane and
  most concrete piece of practical parenting in the corpus, and it carries the
  register of the whole `when-do-children-start-praying` answer.
- **Al-Mughni 3:45-46** — why fasting gets its own test rather than borrowing
  the prayer's ages: `إلا أن الصوم أشق فاعتبرت له الطاقة، لأنه قد يطيق الصلاة
  من لا يطيقه`. Age is the marker, capability is the criterion.
- **Al-Mughni 9:364-365** — the question a revert actually asks about '*aqiqa*:
  if it was never done for you. Ahmad says the moment has passed, `ذلك على
  الوالد`; 'Ata' and al-Hasan say you may do it for yourself, `فينبغي أن يشرع
  له فكاك نفسه`. Two positions, neither binding the other.
- **Fath al-Bari 10:476** — al-Tabari's three-clause test for names
  (`قبيح المعنى` / `يقتضي التزكية` / `معناه السب`) and, more useful, his
  deflation of the whole topic: the name changes were `وجه الاختيار`, not
  prohibition, `ويدل عليه أنه صلى الله عليه وسلم لم يلزم حزنا`. A Companion
  declined a name change from the Prophet himself and was left alone.
- **Al-Minhaj 18:113-116 + Al-Tamhid 16:246-247** — the *kafil al-yatim*
  material read together: al-Nawawi defining the role as `نفقة وكسوة وتأديب
  وتربية` and Ibn 'Abd al-Barr glossing `له أو لغيره` as `من قرابته ومن غير
  قرابته`. That pair is the whole substance of `adoption-in-islam`: the care is
  praised as highly as almost anything in the tradition, and only the
  reassignment of parentage is closed.

### Mechanics

- **Escaped-quote firings 13–17.** Five in this section, the most in any:
  Sunan Abi Dawud 7:97 (the *fitra* hadith), Sunan Abi Dawud 7:308 (Barra →
  Zaynab), Sunan Abi Dawud 7:317-318 (the nicknames verse), Sunan Abi Dawud
  4:457-459 (the *yudamma* note), and Tafsir al-Tabari 12:29-31's neighbours.
  Every one was in a **Sunan Abi Dawud** chunk. The pattern is now specific
  enough to predict: Abu Dawud's edition uses bare `"` around the matn, so any
  quote spanning the full hadith text will fire. Anchor *inside* the matn from
  the start when the source is Abi Dawud.
- **Triple-space anchor misses: four** (Majmu' al-Fatawa 4:245-247, Tafsir
  al-Qurtubi 8:273, Al-Majmu' 8:436, Ahkam al-Qur'an 3:538-539). Unchanged
  workaround; `checkQuotes` collapses whitespace so the stored quotes are fine.
- **One duplicate citation caught before commit** — `naming-a-baby` had the
  same Al-Majmu' 8:436 slice at [2] and [17]. Replaced [2] rather than letting
  the `dupe cited_text` check find it after the fact.
- **One uncited source name accepted as cosmetic** — `naming-a-baby` flags
  `hadith: Bayhaqi`, which appears only inside the faithful English rendering
  of al-Nawawi weighing the chain. Same reasoning as `musical-instruments` and
  `attending-a-christmas-dinner` in the fifteenth addendum.
- **One genuine uncited source name fixed** — `non-muslim-parent-died` named
  al-Bukhari and Muslim in prose about al-Qurtubi's resolution of
  *rabbi ighfir li-qawmi*; rewritten to attribute the point to al-Qurtubi.

### Sections 1–16, 18, 19, 21 and 22 complete — 398/469

---

## Eighteenth addendum — section 11, the Qur'an, 12/12

Section 11 closes the bank at **410/469**. Twelve questions, none of which had a
worksheet or an `also_retrieve` entry at the start. Probes were written for all
twelve first, then all twelve prepared, then drafted.

This section was the strongest retrieval performance of the whole build, and it
is worth recording why, because the reason is transferable.

### Probing toward the *chapter*, not the question

Section 11's questions are mostly modern phrasings of classical chapter
headings. `touching-quran-without-wudu` is *bab mass al-mushaf*;
`disposing-of-old-quran` sits under the '*Uthmanic collection*;
`abrogation-in-quran` is *al-nasikh wa'l-mansukh*. Probing with the ruling's own
technical vocabulary — `لا يمس المصحف إلا طاهر`, `أمر عثمان بتحريق المصاحف`,
`نسخ التلاوة وبقاء الحكم` — landed the governing chapter every time. Twelve
worksheets, twelve usable sheets, **zero re-prepares**. Compare sections 18, 19
and 22, which each needed at least one.

The one probe that deliberately aimed *away* from the question was
`which-translation-should-i-read`. No work in the corpus postdates any English
translation, so the probes were pointed at `الأحرف السبعة`,
`اختلاف القراءات` and `جمع القرآن في مصحف واحد` instead. That is a new move
worth naming: **when a question is unanswerable in the corpus's own terms,
probe toward the question underneath it.** The answer written from those
passages says outright that no translation can be recommended here and why, and
then gives what the sources genuinely have — Ibn Taymiyya's
`اختلاف تنوع وتغاير لا اختلاف تضاد وتناقض`, which is a far better tool for a
reader comparing two English versions than any recommendation would have been.

### The section's best finds

Several of these overturn what the question is usually answered with.

- **Al-Tamhid 17:397-398** — Ishaq b. Rahawayh distinguishing the evidence from
  the proof-text: `لا يقرأ أحد في المصحف إلا وهو متوضئ وليس ذلك لقول الله عز
  وجل لا يمسه إلا المطهرون ولكن لقول رسول الله لا يمس القرآن إلا طاهر`. The
  rule everyone attributes to 56:79 rests, in its own jurists' telling, on the
  letter to 'Amr b. Hazm.
- **Sunan Abi Dawud 1:15-17** — Abu Dawud grading the ring-removal hadith
  `هذا حديث منكر` and naming the confusion: `والوهم فيه من همام، ولم يروه إلا
  همام`. That is the sole textual basis usually offered for not taking a phone
  with a Qur'an app into a lavatory, flagged defective by its own compiler.
  The best single find in the section.
- **Fath al-Bari 9:18** — Ibn Battal reading 'Uthman's burning as
  `اكرام لها وصون عن وطئها بالاقدام`, immediately followed by a named dissent
  (`وكرهه إبراهيم`), and then Ibn Hajar declining to copy the precedent into
  his own century: `وأما الآن فالغسل أولى`. Set against **Al-Mughni 9:246**'s
  flat `وأما المصحف، فلا يحرق ; لحرمته`. Both on the sheet, neither a slip.
- **Fath al-Bari 9:23** — `يا عمر القرآن كله صواب ما لم تجعل رحمة عذابا أو
  عذابا رحمة`, with the Prophet striking 'Umar's chest and saying
  `أبعد شيطانا` three times. And **Al-Minhaj 6:99**'s third reason for
  releasing the man: `لأنه إذا قرأ وهو يلبث لم يتمكن من حضور البال وتحقيق
  القراءة` — someone corrected under pressure recites worse.
- **Al-Fatawa al-Hindiyya 5:317** — the correction etiquette:
  `إن علم أنه إن لقنه الصواب لا تدخله الوحشة يلقنه وإن دخله الوحشة فهو في سعة
  أن لا يلقنه`. A jurist building the effect on the person into the rule
  rather than offering it as sentiment.
- **Fath al-Bari 9:37** — 'A'isha, via Ibn Hajar, on why the revelation is
  ordered as it is: conviction first, rulings after,
  `ولو نزل أول شئ لا تشربوا الخمر لقالوا لا ندعها`. The most useful single
  paragraph in the section for a revert being handed a list of obligations.
- **Fath al-Bari 9:39** — 'Uthman's own account of *Bara'a*:
  `فظننت انها منها فقبض رسول الله ولم يبين لنا انها منها`, and Ibn Hajar's
  `أضافها عثمان إلى الأنفال اجتهادا منه`.
- **Tafsir al-Tabari 2:388-390** — the restriction that disposes of most loose
  argument about abrogation: `فأما الأخبار فلا يكون فيها ناسخ ولا منسوخ`.
  Paired with **Al-Minhaj 1:35**'s `ولا يصار إلى النسخ مع امكان الجمع` and
  **Tafsir al-Qurtubi 2:66**'s `وأما بعد موته واستقرار الشريعة فأجمعت الأمة
  أنه لا نسخ`.
- **Tafsir al-Qurtubi 1:11** — the *maqlub* argument on `زينوا القرآن
  بأصواتكم`: al-Khattabi and others read it inverted, and Ma'mar's narration
  puts the words the other way round, `وهو الصحيح`. A whole disputed ruling
  turning on word order the narrations differ about.
- **Al-Bahr al-Ra'iq 1:350** — a Hanafi jurist asked about a novel case
  answering `لا أعلم فيه منقولا والذي يظهر...`, reasoning from a nearby case
  and marking the answer as his own inference. The best model in the corpus for
  how to handle a question the books never faced — used as such in the
  phone answer.

### On answering questions the corpus cannot reach

Three answers in this section required saying plainly that the sources stop
short, and each does it differently:

- `quran-on-phone-without-wudu` — states what is settled (recitation and
  looking, by consensus), gives the three grounds the jurists actually used
  for treating an object as not a *mushaf* (the name does not apply, guarding
  against it is a hardship, restricting it obstructs learning), notes that a
  phone attracts all three more strongly than a coin does, and then says
  explicitly that the sources do not draw the conclusion — the grounds are
  theirs, the application is not.
- `which-translation-should-i-read` — refuses the recommendation outright in
  the first paragraph, with the reason (every work predates every English
  translation), and marks the translation/*qira'at* parallel as inference.
- `disposing-of-old-quran` — notes that modern recycling is not addressed and
  declines to extend the reasoning to it while showing the reader what question
  a scholar would ask.

The pattern that has settled across sections 15 and 11: **name the missing
thing specifically**, not as a general disclaimer. "Nothing here on court
adoption orders, reissued birth certificates, or surnames" is checkable;
"consult a scholar for specifics" is not.

### Mechanics

- **Escaped-quote firings 18–22.** Five again, and again the source is
  predictive: Sunan Abi Dawud (×3 — the *fitra*/pace/ring chunks), Sahih
  Muslim's 1454-parallel, and Tafsir Ibn Kathir 1:47-48. The Abi Dawud pattern
  recorded in the seventeenth addendum held exactly; the new one is that
  **Ibn Kathir quotes with bare `"` around embedded hadith matn** as well.
  Anchor inside the matn for both.
- **Triple-space misses: six** (Majmu' al-Fatawa 13:405-407, Ahkam al-Qur'an
  4:382-383, Al-Tamhid 17:399-401, Fath al-Bari 6:94, Majmu' al-Fatawa
  13:391-392, Radd al-Muhtar 1:373). Same workaround.
- **Two duplicate citations caught before commit** — `naming-a-baby` (recorded
  in the seventeenth addendum) and `reciting-quran-out-loud`, where the same
  Tafsir al-Qurtubi 1:11 slice sat at [4] and [6]. Both fixed by re-slicing,
  not by dropping a citation.
- **One citation-numbering scramble caught after writing** —
  `non-muslim-touching-quran` had body markers [4] and [7] pointing at the
  wrong citations after a late edit. Fixed by rebuilding the whole citations
  block against the body in order. Same failure class as the `mothers-day`
  numbering slip in the sixteenth addendum; the fix that works is to write the
  citations block *last*, straight down the body.
- **One genuine uncited source name fixed** — `non-muslim-touching-quran`
  named al-Bukhari in prose about a chapter arrangement transmitted through
  Ibn Hajar; reattributed to Ibn Hajar's commentary.
- **Preparation is now the slow step.** Twelve worksheets took roughly twenty
  minutes of wall-clock time at ~29 passages each; two batches had to be
  backgrounded to avoid the two-minute command timeout. Drafting is no longer
  the bottleneck for a section whose probes are right.

### Sections 1–16, 18, 19, 21 and 22 complete — 410/469

---

## Nineteenth addendum — section 24 (Doubts and hard questions), 13/13

Section 24 is the section the app exists to survive. Every other section
answers a question someone already inside the religion is asking. This one
answers the questions that make people leave, or stop them arriving: *is any
of this true, why are women treated differently, what about slavery, what
about the age of 'A'isha, why do Muslims behave like that, what happens if I
walk away, what happens to my mother.* A wrong answer here does more damage
than a wrong answer anywhere else in the bank, and the specific way it does
damage is by being caught out later.

### The rule this section was written under

**Never write a sentence the reader will discover was arranged.** Every one of
these questions has an apologetic version that reads well until the reader
goes and checks. The corpus makes the arranged version unnecessary, and it also
makes it detectable — because the hard sentence is usually sitting three lines
from the reassuring one in the same chunk.

Three places this bit, and in each the answer names the hard thing first:

- `why-are-men-and-women-treated-differently` quotes Ibn Kathir on 4:34 in his
  own words — `لأن الرجال أفضل من النساء، والرجل خير من المرأة؛ ولهذا كانت
  النبوة مختصة بالرجال وكذلك الملك الأعظم` — and says so explicitly: *it is
  not helpful to be told otherwise and then discover it later.*
- `islam-and-slavery` opens by conceding that these books do not abolish
  slavery, and closes by quoting the sell-clause of the same hadith that
  forbids torture, `ومن لم يلائمكم منهم فبيعوه`, sitting in the same line as
  the brotherhood language.
- `leaving-islam` states Al-Mughni 9:18-19 without softening — `أنه إن لم يتب
  قتل ; لما قدمنا ذكره. وهو قول عامة الفقهاء` — before laying out the eight
  ways the same books complicate it.

The compensation for that honesty is that the *good* material then lands,
because the reader has no reason to distrust it.

### What the corpus actually gave, per question

The recurring surprise was that the strongest material was internal criticism —
the tradition arguing with itself — and it is almost always absent from both
the attack and the defence as they circulate today.

- **`age-of-aisha`** — the find of the section. Ibn Hajar, in Fath al-Bari
  9:107, declines to use this marriage to ground the rule: `وليس بواضح الدلالة
  بل يحتمل أن يكون ذلك قبل ورود الامر باستئذان البكر وهو الظاهر فان القصة وقعت
  بمكة قبل الهجرة` — the episode may sit *before* the command to seek a
  virgin's consent. Alongside it: Ibn Battal's `لكن لا يمكن منها حتى تصلح
  للوطء` (the gate is capacity, not the number nine); Ibn 'Abd al-Barr's `لا
  أعلم أحدا قاله غيره` on the one jurist who tried to read a floor of nine out
  of the story; Al-Mughni 7:33's `حكم بنت تسع سنين، حكم بنت ثمان` against the
  second Hanbali narration and 'A'isha's own `إذا بلغت الجارية تسع سنين فهي
  امرأة`; and Fath al-Bari 5:204's spread on *bulugh* running from menses to
  nineteen. Also recorded, plainly: the revisionist chronologies argued today
  are **not in this corpus**, so nothing here confirms or refutes them.
- **`leaving-islam`** — 'Umar's disavowal in Al-Majmu' 19:229, `اللهم إني لم
  أشهد ولم آمر ولم أرض إذا بلغني`, and Ibn Hajar's inference that the
  Companions read `من بدل دينه فاقتلوه` as *if he does not return*. Plus:
  *istitaba* disputed out to `يستتاب أبدا` (al-Nakha'i) and `مائة مرة`
  (al-Hasan); Malik narrowing the hadith away from a Jew turning Christian;
  the Hanafi refusal to execute a woman resting on `ومن روى حديثا كان أعلم
  بتأويله`; and 'Ali accepting Ibn 'Abbas's correction on the burning —
  `فقال: صدق ابن عباس`.
- **`muslims-behaving-badly`** — Al-Nawawi (Al-Minhaj 16:135) puts two limits
  on "covering a Muslim's faults" that answer the modern abuse of that
  principle directly: the known wrongdoer *should not* be covered for, `لان
  الستر على هذا يطمعه في الايذاء والفساد`; and a sin in progress must be
  stopped immediately, `ولا يحل تأخيرها`. And vetting those entrusted with
  charities, endowments and orphans is `فيجب`. Paired with Al-Minhaj 2:10's
  `المسلم الكامل وليس المراد نفى أصل الاسلام عن من لم يكن بهذه الصفة`, which is
  the whole answer to "these people are Muslims."
- **`fate-of-non-muslims`** — Majmu' al-Fatawa 19:215-217 read as a hard limit,
  `فمن لم يأته نذير لم يدخل النار`, and Al-Tamhid 18:97-99's four irreconcilable
  positions on children with the Prophet's own refusal to answer, `الله أعلم بما
  كانوا عاملين`. This overlaps `my-parents-will-go-to-hell` by design; that one
  is the personal question, this one the doctrinal shape.
- **`how-do-i-know-islam-is-true`** — Majmu' al-Fatawa 11:377-378 records
  al-Bayhaqi via al-Khattabi observing that `وعلى هذا الوجه كان إيمان أكثر
  المستجيبين للرسول` — most who answered the Messenger came via prophethood,
  not via metaphysics. That is the single most useful sentence in the section
  for a seeker: you are not required to finish a kalam course first. Paired
  with Fath al-Bari 9:6's `معجزات الأنبياء انقرضت بانقراض اعصارهم` and
  6:424's honest concession that the individual miracle reports are `ظنية`
  and the case rests on the aggregate, `كما يقطع بوجود جود حاتم وشجاعة على`.
- **`cultural-vs-islamic`** — Al-Ashbah wa'l-Naza'ir 1:90 as the corrective to
  the whole "culture is contamination" frame: custom is a working instrument
  of the fiqh in cases beyond counting, down to `عادة بلد البيع`. With Ibn
  al-'Arabi's `ولولا أنه معروف ما أدخله الله تعالى في المعروف` and the sentence
  that is the key to the answer — `وهذا واجب على الزوج ولا يلزمه ذلك في
  القضاء`: the enforceable rules are a floor, not a description.

### The new move: naming the corpus's silence as part of the answer

Every question in this section closes with an explicit statement of what these
books cannot reach, and in this section that statement is load-bearing rather
than a disclaimer:

- The i'jaz argument is at full force only in Arabic — said outright in
  `how-do-i-know-islam-is-true` rather than left for the reader to discover.
- No premodern work here argues slavery must end; the modern abolition
  arguments are named as modern and *not sourced from this shelf*.
- `leaving-islam` refuses to manufacture a reconciliation between 2:256 and
  the ruling: *both are in these books; the reconciliation is not on this page.*
- `why-are-men-and-women-treated-differently` lists what is missing by name —
  qiwama when the wife earns more, women in the judiciary, inheritance in a
  wage economy.

This is the seventeenth addendum's rule ("name the missing thing specifically")
applied where it costs something. A vague "consult a scholar" would have been
easier and would have been the tell.

### Three questions were answered as three separate questions

`why-are-men-and-women-treated-differently` was the one that would have gone
wrong as a single answer. It only works once split into (1) standing before
God — undifferentiated, and the Qur'an says so in ten matched pairs; (2) the
value and protection of the person — undifferentiated, Malik on qisas, `فنفس
المرأة الحرة بنفس الرجل الحر وجرحها بجرحه`; (3) household roles and evidentiary
procedure — differentiated, on two stated grounds. Most of the heat in the
modern argument comes from arguing about (3) while implying (1).

### Retrieval and mechanical notes

- **All thirteen worksheets were prepared before this session and all thirteen
  were usable. Zero re-prepares.** The section-11 discipline (probe toward the
  chapter, in the ruling's own vocabulary) transferred intact.
- **`my-parents-will-go-to-hell` had English probes** and its first worksheet
  missed the entire *ahl al-fatra* literature. Replaced with Arabic, re-prepared,
  and the sheet came back with Majmu' al-Fatawa 19:215-217, Qurtubi 10:232 and
  Al-Minhaj 7:46-47. **Recommendation to the reviewer: other early-written
  questions may still carry English probes.** This is the vocabulary-gap failure
  the plan predicted, caught once at scale.
- **Zero escaped-quote firings this section** — the first section with none.
  The predictive rule from the eighteenth addendum held: anchor *inside* the
  matn from the start wherever the source wraps it in a bare `"`. It fired
  preventively in `islam-and-slavery` (Sunan Abi Dawud 7:468, Sunan Ibn Majah
  2:844-845) and `muslims-behaving-badly` (Musnad Ahmad, Tirmidhi), where the
  anchors were set inside the matn without needing a failed pass first.
- **Two triple-space anchor misses**: Tafsir al-Qurtubi 2:211 (`في   الحق`) and
  Al-Tamhid 19:98 (`عني به   غير الأب`). Both resolved by shortening the end
  anchor rather than loosening the start.
- **Two uncited source-name flags accepted as cosmetic** —
  `how-do-i-know-islam-is-true` (Bayhaqi) and `age-of-aisha` (Bukhari); in both
  the name appears only inside a faithful rendering of a cited passage or in a
  description of the cited work itself.
- **Integrity checks at section close, all clean**: 0 published, 0 duplicate
  cited_text, 0 escaped quotes, 422 answers, 4,387 citations.

### For the reviewer, before anything in this section is published

The plan already flags `suicide-in-islam` and `my-parents-will-go-to-hell` as
the two that set the register. Add to that list, and read them first:
`leaving-islam`, `age-of-aisha`, `why-are-men-and-women-treated-differently`
and `islam-and-slavery`. Each of these quotes a classical position that a
reader may find repugnant, in full, deliberately, on the reasoning above.
That is a judgement call about editorial policy, not just about accuracy, and
it is yours to confirm or overturn before a named reviewer's name goes on it.

### Sections 1–16, 18, 19, 21, 22 and 24 complete — 422/469

---

## Twentieth addendum — section 20 (Death and funerals), 11/11

Section 20 is the first section drafted from cold: no probes, no worksheets. All
eleven `also_retrieve` sets were written for this session, all eleven sheets
prepared in two backgrounded batches, and all eleven were usable on the first
pass. Bank 422 → 433/469.

### What made this section different

Every other section answers a question someone is *thinking about*. This one
answers questions someone is standing in the middle of, often at two in the
morning, with a body in the next room. That changed the shape of the writing in
three ways:

- **`what-to-do-when-someone-dies` and `how-to-pray-janazah` both open with a
  bolded operational summary before any citation.** If the reader gets no
  further than the first paragraph they should still have done the right thing.
  For the janazah answer that summary is four sentences: four takbirs, standing,
  no bowing, follow the imam, salaam.
- **The `fard kifaya` framing is load-bearing and is stated early.** Al-Minhaj
  7:3-4 — `وأصل غسل الميت فرض كفاية وكذلك حمله وكفنه والصلاة عليه ودفنه كلها
  فروض كفاية` — is what tells a frightened reader that they are not personally
  required to wash a body they have never washed. They are required to make a
  phone call. That sentence does more work than any ruling in the section.
- **Every answer names where the law meets a modern burial authority.**
  Coroners, mandatory coffins, concrete liners, cemetery rules, death
  registration. The honest note is that the coffin ruling is `يكره` and that
  the *lahd*/*shaqq* question was already an open disagreement among the
  Companions, so a burial constrained by local law is a constrained form, not a
  failed burial.

### The finds

- **Al-Kasani, Bada'i 1:303** — the answer to a question converts ask constantly
  and get bad answers to. `لا بأس بأن يغسله ويكفنه ويتبع جنازته ويدفنه لان الابن
  ما نهى عن البر بمكان أبيه الكافر`, with three precedents: 'Ali told to wash
  and bury Abu Talib; Ibn 'Abbas telling a man to wash, shroud and bury his
  Christian wife; al-Harith b. Abi Rabi'a following his Christian mother's
  funeral with a group of Companions. And the qualification — the relative does
  this only where there is nobody of the deceased's own religion to do it.
- **Al-Mughni 2:187-188** — the Prophet at a grave giving instructions, then:
  `ما بي أن يكون يغني عنه شيئا، ولكن الله يحب إذا عمل العمل أن يحكم` and
  `ولكنه أطيب لأنفس أهله`. The humane centre of the burial answer.
- **Al-Minhaj 16:135** — reused from section 24 in a different register: the two
  limits on concealing faults. Not used here; noted because the same passage
  keeps earning its retrieval.
- **Al-Mughni 2:215 with Jarir and 'Umar** — `فهل يجتمعون عند أهل الميت،
  ويجعلون الطعام ؟ قال: نعم. قال: ذاك النوح`. Food goes *to* the bereaved, not
  from them; the family cooking for visitors is `مكروه`. This runs directly
  against widespread practice and is stated as such rather than softened.
- **Majmu' al-Fatawa 24:314-317** — Ibn Taymiyya's taxonomy, which is the whole
  spine of `praying-for-the-dead`: charity, hajj, sacrifice, manumission, du'a
  and istighfar reach `بلا نزاع بين الأئمة`; fasting, voluntary prayer and
  Qur'an recitation are `قولان`; hiring a reciter is out. Paired with al-Minhaj
  1:90 — denying that *any* reward reaches the dead is `مذهب باطل قطعيا`.
- **Majmu' al-Fatawa 24:333-335** — `زيارة شرعية` vs `زيارة بدعية`, with the
  test: greeting and supplication *for* the deceased, in the manner of praying
  over his bier. And the report that visiting his mother's grave was permitted
  while seeking forgiveness for her was not — which separates two things
  converts routinely have conflated for them.
- **Al-Majmu' 9:53** — the find of the section, in `organ-donation`. `إذا وجد
  المضطر آدميا ميتا حل له أكله عندنا` against `وقال مالك وأحمد وأصحاب الظاهر لا
  يجوز`. Whether one person's body may be used to keep another alive is a
  *classical* disagreement, along the same fault line as the modern one.

### How `organ-donation` and `cremation` were handled

Both are questions the corpus does not answer, and the two answers take opposite
approaches to that — deliberately.

`cremation` **reaches a ruling** and shows the derivation, because the three
inputs are each stated directly (burial obligatory: Qurtubi 19:161 and Ibn
al-'Arabi 2:86; the body's inviolability: `كسر عظم الميت ككسره حيا`; fire
reserved: `لا يعذب بالنار إلا رب النار`) even though no author states the
conclusion. The answer says so explicitly rather than implying a text exists.
It also flags that the fire hadiths are about *punishment* and would be sloppy
to quote as a direct prohibition of cremation.

`organ-donation` **refuses to reach a ruling** and instead lays out the
materials both modern sides argue from, because the crux — brainstem death —
is not merely unaddressed but *inconceivable* to these authors. What the answer
can do, and does: identify the one part the corpus reaches firmly (al-Fatawa
al-Hindiyya 3:115 carves human bone and human skin out of what may be sold or
tanned, twice by name, which is where the modern prohibition on organ *sale*
comes from); surface the bone-graft cases as transplants in miniature, including
that a graft is not extracted from the corpse (`والمنصوص انه لا يقلع`); and
apply Ibn Taymiyya's own necessity test honestly, noting that it lands
*against* his conclusion for transplants — an organ transplant is closer to his
"certainly attains its object" category than the medicines he was refusing.

That distinction — derive when the inputs are stated, decline when the crux is
absent — is the rule this section establishes and it should govern sections 17
and 23, where most of the remaining questions are of the second kind.

### Mechanical notes

- **Eleven probe sets written, eleven sheets prepared, eleven usable, one
  re-prepare** — `praying-for-the-dead` silently failed in the first backgrounded
  batch (five of six wrote) and was re-run alone. Worth watching: a backgrounded
  loop can drop an item without a non-zero exit.
- **Three escaped-quote firings, all caught pre-commit** in `how-are-muslims-buried`
  (Al-Majmu' 5:291 twice, Al-Mughni 2:187-188 once). All fixed by splitting one
  span into two rather than re-anchoring. The Al-Majmu' pattern is now
  predictive: al-Nawawi wraps embedded hadith in bare `"`.
- **One Arabic typo caught after commit** — `لا تجلوسوا` for `لا تجلسوا` in the
  prose of `visiting-graves`. `checkQuotes` validates citation strings only, so
  Arabic *inside the answer body* is unverified. Fixed and recommitted. This is
  a real gap in the verification chain; a body-Arabic check would catch it.
- **One genuine uncited-numeral flag** — `inheritance-shares` had "2:1" in prose
  describing the son/daughter ratio, which the commit checker read as a Qur'an
  reference. Reworded to "two-to-one." Correct catch by the checker.
- **Integrity checks at section close, all clean**: 0 published, 0 duplicate
  cited_text, 0 escaped quotes, 433 answers, 4,583 citations.

### Sections 1–16, 18, 19, 20, 21, 22 and 24 complete — 433/469

Remaining: **17. Money and work (25)** and **23. Health and medicine (11)** —
the two the plan held back deliberately, and the two where the corpus runs out
most often. The `organ-donation` pattern is the one to carry into them.

---

## Twenty-first addendum — section 23 complete, and section 22 closed

**11 answers: the last 7 of Health and medicine, plus `what-do-i-say-when`.**
Bank 436 → 444/469. Citations 4,583 → 4,768. Sections 22 and 23 are now both
complete; only **17. Money and work (25)** remains.

### The derive/decline rule held, and it split this section cleanly in two

Section 20's rule — derive when the inputs are stated, decline when the crux is
absent — turned out to sort these questions almost mechanically, and the sorting
did not follow the `expect:` flags.

**Derived, with the reasoning shown:**

- `cosmetic-surgery` (tier B). The cleanest derivation yet, because the corpus
  supplies all three parts: the prohibition names its own scope — `للحسن`,
  *for beauty*, and `المغيرات خلق الله`; Ibn Hajar states the exception outright
  (`ويستثنى من ذلك ما يحصل به الضرر والأذية` — Fath 10:318, with the extra tooth
  and the extra finger as his own examples, and `والرجل في هذا الأخير كالمرأة`);
  and there is a **decided case**, 'Arfaja's prosthetic nose, where the Prophet
  ordered gold and thereby overrode a standing prohibition. Al-Kasani extracts
  the rule in as many words: `فكان فيه ضرورة فسقط اعتبار حرمته` (Bada'i 5:132).
  Reconstructive lands on the permitted side with a case behind it.
- `fasting-with-a-medical-condition` (flagged `decline`). Declined on the medical
  fact, as it should be — but the *legal* framework is fully stated and was set
  out in full, because the person asking almost always has it wrong. The load-
  bearing find is al-Nawawi, Al-Majmu' 6:259: `هذا إذا كان يناله بالصوم مشقة لا
  تحتمل ولا يشترط خوف الهلاك` — **fear of death is not the standard.** Paired
  with Al-Mughni 3:38's two categories (`المريض الذي لا يرجى برؤه` feeds instead
  of making up; `فإن رجا ذلك فلا فدية عليه` and waits), this tells the reader
  exactly which question to put to their doctor.
- `mental-health-and-islam` and `is-depression-weak-faith`.

**Declined, with the missing crux named:**

- `vaccines`. No author imagined inoculation; the word `لقاح` in these books means
  a milch-camel, and the retrieval landing on Salama b. al-Akwa''s camels is
  itself the evidence. But three sub-questions *are* settled — acting against an
  illness one does not have (the plague rule, and al-Qurtubi generalising it at
  3:233: `فكذلك الواجب أن يكون حكم كل متق من الأمور غوائلها سبيله في ذلك سبيل
  الطاعون`), precaution versus reliance, and `لا عدوى`. The last has the best
  find of the section: al-'Imrani via Al-Majmu' 16:269-270 distinguishing what
  was denied (`تعدى بأنفسها وطباعها`) from what is affirmed (`جرت العادة أن يخلق
  الداء عند ملاقاة الجسم الذي فيه الداء`) — the classical account of secondary
  causation, which is exactly why germ theory raises no problem here.
- `ivf-and-fertility-treatment`. **The silence is uneven, and saying so is the
  answer.** On third parties the material is dense and firm — Ibn al-'Arabi's
  definition (`النسب عبارة عن خلط الماء بين الذكر والأنثى على وجه الشرع فإن كان
  بمعصية كان خلقا مطلقا ولم يكن نسبا محققا`), `الولد للفراش`, Hindiyya 4:127 that
  nasab cannot be conferred by claim, and Al-Mabsut 17:100 `وأمر النسب مبنى على
  الاحتياط`. On a couple's own gametes it is silent entirely. The page says both,
  and turns the caution principle into a practical question about clinic
  chain-of-custody.
- `abortion-in-islam`.
- `medicine-containing-gelatin` (previous session, same pattern).

### `abortion-in-islam` — the one to read before publishing

Radd al-Muhtar 3:192-193 carries a section literally headed `مطلب في حكم إسقاط
الحمل`, and it contains the whole argument rather than a slogan: al-Nahr's
permission before 120 days; the Khaniyya's `ولا أقول بالحل` with the game-egg
analogy and `فلا أقل من أن يلحقها إثم هنا إذا أسقطت بغير عذر`; al-Faqih 'Ali b.
Musa's `فإن الماء بعد ما وقع في الرحم مآله الحياة فيكون له حكم الحياة`; and Ibn
Wahban's summary, which is the sentence the whole page turns on — `فإباحة
الاسقاط محمولة على حالة العذر، أو أنها لا تأثم إثم القتل`.

Two things made this page possible without editorialising. First, Ibn 'Abidin
himself records that observation undercuts the timetable his school reasons
from: `وإلا فهو غلط لان التخليق يتحقق بالمشاهدة قبل هذه المدة`. Second, the
objection that a foetus is legally nothing was raised at the time, in rhymed
prose, and rejected — Hamal b. al-Nabigha's `كيف أغرم من لا شرب ولا أكل`.

The result contradicts **both** slogans, and says so explicitly. Add it to the
reviewer's read-first list alongside `leaving-islam`, `age-of-aisha`,
`why-are-men-and-women-treated-differently`, `islam-and-slavery`,
`suicide-in-islam` and `my-parents-will-go-to-hell`.

### `is-depression-weak-faith` — the corpus inverts the premise

Worth noting as a pattern for section 17: the strongest answer to an accusation
is sometimes that the tradition being invoked says the opposite. The Sa'd hadith
(`أي الناس أشد بلاء؟ قال: الأنبياء ثم الأمثل` … `يبتلى الرجل على حسب دينه`) makes
the inference from suffering to spiritual standing run backwards, and `هم`,
`حزن` and `غم` appear **by name** in the expiation list (Majmu' al-Fatawa
7:81-82). Ibn al-'Arabi on Ya'qub gives the line the whole page rests on:
`ولكن حزنه كان في قلبه جبلة ولم يكتسب لسانه قولا قلقا يخالف الشريعة` — the line
is drawn between heart and tongue, not between the composed and the grieving.
The reason given is not an exception but the premise: `حين علم عجز الخلق عن
الصبر ؛ فأذن لهم في الدمع والحزن ولم يؤاخذهم به`.

`mental-health-and-islam` was kept distinct from it deliberately: that page is
about treatment (Fath 10:91 `هما من أمراض الباطن`; Al-Majmu'/Al-Minhaj 14:191-193
on `استحباب الدواء` and `الأطباء مجمعون على أن المرض الواحد يختلف علاجه`), and
reports Ibn 'Abd al-Barr's genuine dissent that treatment is `إباحة` and `لا أنه
سنة ولا أنه واجب` — a range running from *permitted* to *recommended*, never to
*forbidden*.

### `what-do-i-say-when` — closing section 22

The Aug 21 worksheet was rightly judged too weak; the replacement Arabic probes
found Al-Majmu' 4:647-650, which is a catalogue of exactly this question —
waking, dressing, leaving and entering the house, morning and evening, sleep,
fright, dreams, distress. It also supplied *mashallah*, which the earlier sheet
missed entirely: `وليقل لدفع الآفات ما شاء الله لا قوة الا بالله`. The page
frames `إن شاء الله` as al-Qurtubi does — a truthfulness device, not a hedge —
and gives the sneeze exchange with its **condition** (`وإذا لم يحمد الله فلا
تشمتوه`) and the `يهديكم الله ويصلح بالكم` variant with its precedent.

### Mechanical notes

- **The scratchpad is being pruned mid-session**, not merely wiped at session
  start: `peek.py` and `qq.py` vanished between calls while a file written
  minutes later survived. Recreate on failure rather than assuming they persist.
- **The Docker container stopped mid-session** after a successful start, with a
  clean shutdown in the log. Re-check `pg_isready` before a batch of dumps
  rather than trusting an earlier `docker start`.
- **A worksheet's citation markers are required.** `vaccines` was first written
  with translit­erated Arabic in prose and no `[n]` markers; commit refused with
  *citations … are never referenced in the answer*. House style is backticked
  Arabic followed by `[n]`. Rewritten and committed.
- **A wrong passage number is caught by `checkQuotes`, not silently accepted** —
  `abortion-in-islam` cited Fath 11:422 as passage 11 (it is passage 9). The
  checker named the source it could not find the text in, which made it a
  ten-second fix.
- **Anchor misses were all whitespace**, five of them, every one a triple space
  or line break inside the chunk (`بقي   هل`, `من هذيل   رمت`, `الفطر في   السفر`).
  Re-anchoring past the gap is now routine.
- **A new body check, and it caught something.** Scanning the answer body for
  characters that are neither ASCII nor Arabic found a stray Cyrillic word in
  the draft of `mental-health-and-islam` ("what their selves говорят within
  them"), fixed before commit. This is the cheap partial fix for the gap the
  twentieth addendum recorded: it will not catch an Arabic typo, but it catches
  script mixing for nothing. Worth adding beside `checkQuotes` as a real script.
- **Integrity checks at section close, all clean**: 0 published, 0 duplicate
  cited_text, 0 escaped quotes, 444 answers, 4,768 citations.

### Sections 1–16 and 18–24 complete — 444/469

Remaining: **17. Money and work (25)** only. It has no probes and no worksheets
yet, so it begins as section 20 did — with 25 Arabic probe sets. The derive/
decline rule applies, and this section will lean hardest on it: `riba`,
`insurance`, `crypto` and `certification` are the cases where the corpus's
inputs are either fully stated (loans, `غرر`, the exchange contracts) or wholly
absent (a modern instrument's structure), and the two must not be blurred.

---

## Twenty-second addendum — section 17 complete, and the bank is finished

**28 answers: all of Money and work.** Bank 444 → **469/469**. Citations 4,768 →
**4,986**. Every question in `content/questions.yaml` now has a draft answer.
None is published.

### The section has a spine, and it is one sentence

Almost every question here reduces to a single test, stated by al-Nawawi in
`Al-Minhaj 11:37`: `لأن المنهي عنه ما كان مشروطا في عقد القرض` — **what is
forbidden is what was stipulated in the loan contract.** Ibn Hajar gives the
same with the consensus attached (`Fath 5:43`): repaying better than you
borrowed is fine `إذا لم تقع شرطية ذلك في العقد فيحرم حينئذ اتفاقا`.

That criterion, plus al-Tabari's framing of what the prohibition is aimed at
(`الزيادة التي يزاد رب المال بسبب زيادته غريمه في الأجل` — profit in trade is
lawful; a return for extending a term is not), sorts `savings-account-interest`,
`credit-cards`, `student-loans`, `buy-now-pay-later`, `car-finance` and
`pension-scheme-at-work` without strain. The pages that were hard were hard for
other reasons.

### The finds that carried whole pages

- **`what-is-riba`.** The most useful thing in the section is not a ruling but a
  disagreement: al-Nawawi's summary of the four positions on the `علة` (11:9) and
  Ibn Taymiyya's fuller range (29:470-472), ending with `أو النهي غير معلل
  والحكم مقصور على مورد النص`. Every modern dispute about paper money or digital
  currency is a continuation of it. Saying so is more honest than a formula.
- **`is-crypto-halal`.** The `فلوس النافقة` precedent, and Ibn Taymiyya's
  `الفلوس هي في الأصل من باب العروض والثمنية عارضة لها` — the whole modern
  argument in nine words. Plus the Hanafi jab at the Shafi'is in Al-Majmu' 9:393:
  `وقد يوجد الحكم ولا علة كالفلوس بخراسان وغيرهما فإنها أثمان ولا ربا فيها
  عندكم`. Nobody today is starting from scratch.
- **`is-a-mortgage-allowed`.** Ibn 'Abbas's `أرى مائة بخمسين بينهما حريرة` — a
  hundred for fifty with a scrap of silk between them — is the sharpest
  instrument in the section, and al-Qurtubi's `والسلعة لغو` turns it into a test
  a reader can apply to a real contract.
- **`is-freelancing-for-a-haram-client-ok`.** Al-Kasani's paired example
  (Bada'i 5:233) transfers almost unchanged: selling weapons to combatants is
  assistance; selling the iron is not, `لأنه ليس معدا للقتال فلا يتحقق معنى
  الإعانة`; and `بيع الخشب الذي يصلح لاتخاذ المزمار` is fine though selling
  flutes is not. Wood or flute — that is the whole page.
- **`is-trading-forex-allowed`.** 'Umar's `والله لا تفارقه حتى تأخذ منه`, and his
  own instruction that if the man asks you to wait while he steps indoors,
  `فلا تنظره`. A walk into a house was too long a delay. Retail leveraged forex
  fails a condition Ibn al-Mundhir reports as agreed without dissent.
- **`working-at-a-bank`.** The limit inside the same Fath al-Bari passage that
  carries the threat: it reaches `من واطأ صاحب الربا عليه`, while one who records
  the matter so the truth may be acted upon `فهذا جميل القصد لا يدخل في الوعيد
  المذكور`. That converts a blanket anxiety into a question about role.
- **`working-in-a-supermarket-selling-pork`.** Al-Nawawi answering the exact
  modern fear in as many words: `ما يقوله العوام اختلاط الحلال بالحرام يحرمه
  فباطل لا أصل له`.
- **`gambling-and-lottery`.** Mujahid's generalisation — `كل شئ فيه قمار فهو
  ميسر حتى لعب الصبيان بالجوز` — plus the `محلل` device, which gives a
  *structural* test: the vice is each participant standing to lose a stake.
- **`cutting-corners-at-work`.** Ibn Qudama's `أجير خاص` / `مشترك` distinction.
  What most employees sell is a period, of which the hirer's claim is
  `لاختصاص المستأجر بنفعه في تلك المدة دون سائر الناس` — exclusive. Slacking
  becomes a question about what was handed over, not about character.
- **`working-with-opposite-gender`.** Al-Nawawi's grammatical point does the
  work: the `محرم` clause is `استثناء منقطع`, because where a third party is
  present **there is no seclusion at all**. The rule names a situation, not a
  workplace — and reverses into an obligation in an emergency.

### Where the section declined, and why

`is-insurance-allowed` is the clearest case of the derive/decline rule paying
off. Both halves of the modern argument are here in full — Ibn Taymiyya's
sharpening of `غرر` into `مخاطرة ومقامرة`, and the `عاقلة` with al-Jassas
answering the "no soul bears another's burden" objection (`على وجه المواساة`)
and describing mechanics that are recognisably premiums. The page sets out both
and does not rule. The same applies to `is-crypto-halal` and to the contested
half of `student-loans`.

**A recurring honesty problem worth recording:** several pages had to say that a
modern argument has *no* classical text to test it against — inflation as a
justification for interest (`savings-account-interest`, `student-loans`), and
screening ratios for equities (`stocks-and-shares`). In each case the temptation
was to dress a contemporary judgement in classical clothing. The rule applied
was to name the gap and attribute the applied judgement to whoever is making it.

### Mechanical notes

- **A `##` heading inside an answer body silently truncates the parsed answer.**
  `what-is-riba` was written with subheadings; only citation 1 registered, and
  the commit refused with *citations 2–14 are never referenced*. The citation
  check caught what nothing else would have — the quotes were all valid. **Use
  bold, never `##`, for structure inside an answer.**
- **`prepare` gets killed on long runs and leaves a truncated worksheet, not an
  absent one.** Three sheets came back with exactly 12 passages — the base
  retrieval with no probe passes — and one of those reported success. File
  existence is not a sufficient check. Verify by passage count; a healthy sheet
  is 35–47, and anything under 20 should be deleted and rebuilt.
- **A wrong passage number is caught by `checkQuotes`**, which names the source
  it could not find the text in (`abortion-in-islam`, Fath 11:422 cited as
  passage 11 when it is passage 9).
- **`what-do-i-do-with-interest-money` needed its probes replaced.** The first
  set landed on stolen property, orphans' wealth and lost property rather than
  the disposal literature. The replacement used the phrases the books actually
  use — including `فمن جاءه موعظة من ربه فانتهى فله ما سلف` — and returned
  al-Ghazali's full procedure in Al-Majmu' 9:351. **Judge a worksheet before
  drafting on it; a weak sheet is a probe problem, not an absence.**
- **My running count drifted.** Re-commits of the same slug were being counted as
  new answers, overstating progress by three at one point. The database is the
  only reliable count: `select count(*) from answers`.
- **All four integrity checks clean**: 0 published, 0 duplicate cited_text,
  0 escaped quotes, **469 answers, 4,986 citations**. Body script scan clean
  across the section.

### 469/469 — the drafting phase is done

Nothing is published, and nothing should be until a named human reviewer has
read it. The reviewer's read-first list now stands at: `suicide-in-islam`,
`my-parents-will-go-to-hell`, `leaving-islam`, `age-of-aisha`,
`why-are-men-and-women-treated-differently`, `islam-and-slavery`, and
`abortion-in-islam`.

Next steps are no longer drafting: review and publish at `/review`; deploy, which
needs `REVIEW_TOKEN` set; build the `evals/` harness; read the miss log back into
`questions.yaml`. Two smaller items are outstanding — a body-Arabic check to sit
beside `checkQuotes` (the script scan added this session catches script mixing
but not Arabic typos), and a sweep of the earliest-written questions for
leftover English probes.
