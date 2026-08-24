/**
 * Bridge the vocabulary gap between how people ask and how the corpus reads.
 *
 * The only English text in the corpus is Pickthall's 1930 translation of the
 * Qur'an, and it renders Islamic terms into the English of its day: *riba* is
 * "usury", *zakat* is "the poor-due", *wudu* is "ablution". A reader — and the
 * curated question set — uses the Arabic terms. Nothing bridges the two, and
 * the failure is silent and total rather than partial:
 *
 *     "what is riba and why is it prohibited"
 *       → Qur'an 6:145 (0.013), 7:157 (0.003)      wrong verses, no signal
 *     "what does the Qur'an say about usury"
 *       → 2:275 (0.985), 30:39 (0.944), 4:161 (0.943), 3:130 (0.941)
 *
 * Those four *are* the riba verses. They sit in the corpus, perfectly
 * retrievable, and the question as actually written never reaches them.
 *
 * So each term is glossed into the query with the wording the translation uses,
 * before embedding. The gloss is **added, not substituted** — the Arabic term
 * carries meaning for the Arabic corpus, which is most of the library, and
 * replacing it would trade one blind spot for another.
 *
 * Scope: query-side only. The corpus is never rewritten, and a reader is never
 * shown the expanded form.
 */

/**
 * Term → the words Pickthall actually uses, plus the plain-English synonyms a
 * reader might reach for. Keys are matched whole-word and case-insensitively.
 *
 * Kept to terms where the translation genuinely differs. Glossing a word the
 * translation already uses would only dilute the query.
 */
const GLOSS: Record<string, string> = {
  // Wealth and transactions — the widest gap, since Pickthall's vocabulary here
  // is the most dated.
  riba: "usury interest",
  zakat: "the poor-due almsgiving",
  zakah: "the poor-due almsgiving",
  sadaqah: "alms charity",
  sadaqa: "alms charity",
  nisab: "threshold of wealth",
  mahr: "dowry marriage portion",

  // Prayer and purity.
  salah: "prayer worship",
  salat: "prayer worship",
  wudu: "ablution washing before prayer",
  ghusl: "bathing ritual washing",
  tayammum: "purification with earth or sand",
  masjid: "mosque place of worship",
  jumuah: "Friday congregational prayer",
  "jumu'ah": "Friday congregational prayer",
  adhan: "call to prayer",
  qiblah: "direction of prayer Kaaba",
  witr: "night prayer",

  // Fasting and pilgrimage.
  sawm: "fasting",
  iftar: "breaking the fast",
  suhur: "meal before dawn",
  fidya: "compensation feeding the poor",
  kaffara: "expiation atonement",
  qada: "making up a missed obligation",
  hajj: "pilgrimage",
  umrah: "lesser pilgrimage",
  ihram: "state of consecration for pilgrimage",

  // Law and belief.
  halal: "lawful permitted",
  haram: "forbidden unlawful",
  makruh: "disliked discouraged",
  fard: "obligatory duty",
  sunnah: "practice of the Prophet",
  shahada: "testimony of faith declaration there is no god but Allah",
  tawbah: "repentance turning to God",
  taqwa: "God-consciousness piety warding off evil",
  shirk: "associating partners with Allah idolatry",
  kufr: "disbelief",
  iddah: "waiting period after divorce or widowhood",
  talaq: "divorce",
  nikah: "marriage contract",
  mahram: "unmarriageable close relative",
  awrah: "parts of the body to be covered",
  janazah: "funeral prayer burial",
};

/**
 * Modern things the corpus has never heard of, mapped to the matter they turn
 * on.
 *
 * `GLOSS` above translates a term the sources *do* use. This is a harder
 * problem: the corpus stops in 1836 and contains no mortgage, no insurance
 * policy, no camera. What it contains is the principle underneath — a loan
 * repaid with a stipulated increase, a contract whose outcome is unknown, the
 * making of images — and a question that names only the modern instrument never
 * reaches it.
 *
 *     "can I take out a mortgage to buy a house"
 *       → Al-Majmu' 13:175-176, nothing usable
 *     same question, expanded
 *       → Al-Mughni 4:212-214 (the chapters on qard), Qur'an 2:275, 2:245,
 *         2:282, Malik on loans
 *
 * These expansions are a claim about *what the question is about*, which makes
 * them editorial rather than mechanical. Keep them to the matter the classical
 * texts genuinely address, and do not smuggle a conclusion in: 'mortgage' maps
 * to the vocabulary of lending at increase because that is where the discussion
 * lives, not because this file has decided every mortgage is unlawful. The
 * answer says what the sources say and then refers the reader on.
 */
const CONCEPT: Record<string, string> = {
  // Money.
  mortgage: "a loan repaid with a stipulated increase, usury, debt",
  "home loan": "a loan repaid with a stipulated increase, usury, debt",
  "car loan": "a loan repaid with a stipulated increase, usury, debt",
  "student loan": "a loan repaid with a stipulated increase, usury, debt",
  "credit card": "a loan repaid with a stipulated increase, usury, debt",
  "savings account": "a deposit lent at increase, usury, lawful earnings",
  "bank account": "a deposit lent at increase, usury, lawful earnings",
  "interest rate": "a stipulated increase on a loan, usury",
  insurance: "a contract whose outcome is uncertain, gharar, gambling",
  pension: "a contract whose outcome is uncertain, lawful earnings",
  cryptocurrency: "a thing of uncertain value exchanged, gharar, currency",
  bitcoin: "a thing of uncertain value exchanged, gharar, currency",
  lottery: "maysir, qimar, gambling, a wager",
  betting: "maysir, qimar, gambling, a wager",
  gambling: "maysir, qimar, a wager",
  investing: "trade, partnership, lawful earnings",

  // Technology and media.
  photograph: "making images, taswir, pictures",
  photography: "making images, taswir, pictures",
  photos: "making images, taswir, pictures",
  selfie: "making images, taswir, pictures",
  camera: "making images, taswir, pictures",
  "social media": "backbiting, gheeba, slander, guarding the tongue",
  gossip: "backbiting, gheeba, slander, guarding the tongue",
  "video games": "idle amusement, lahw, wasting time",
  television: "idle amusement, lahw, images",
  music: "singing, idle talk, lahw al-hadith, musical instruments",

  // Work and social life.
  workplace: "earnings, lawful and unlawful trade, dealings between people",
  colleague: "dealings between people, seclusion, lowering the gaze",
  "opposite gender": "seclusion, khalwa, lowering the gaze, unrelated men and women",
  dating: "courtship, betrothal, seclusion, khalwa, marriage",
  girlfriend: "courtship, seclusion, khalwa, unlawful relations",
  boyfriend: "courtship, seclusion, khalwa, unlawful relations",
  restaurant: "food of the People of the Book, slaughtered meat, lawful food",
  supermarket: "food of the People of the Book, slaughtered meat, lawful food",
  gelatin: "what is derived from an impure or unslaughtered animal",
  birthday: "the festivals of other peoples, innovation, custom",
  christmas: "the festivals of other peoples, resembling them, custom",
};

/**
 * Practical acts of worship, mapped to the vocabulary of the chapters that
 * discuss them rather than the verse that mentions them.
 *
 * A tier audit over all 469 questions found one failure repeated at scale: a
 * practical question lands on the single ayah about its topic, and never on the
 * fiqh chapter that answers it. Ten separate wudu questions — nail polish,
 * contact lenses, a cast, a public bathroom — all returned Qur'an 5:6 or its
 * tafsir. 5:6 is the verse that commands washing; it does not say whether nail
 * varnish is a barrier. Al-Mughni, Al-Hidaya and Al-Majmu' devote chapters to
 * exactly that, in Arabic, and so lose to the one English text in the corpus.
 *
 * Ten fasting questions collapsed onto 2:187 the same way, four Hajj questions
 * onto 2:196, eight dress questions onto the hijab verses.
 *
 * **The gloss is in Arabic**, and that is the whole of why it works. An English
 * expansion helped a little; the Arabic term transformed it, because the
 * reranker scores an Arabic query against Arabic prose the way it scores
 * English against English, and scores across the two poorly. Measured:
 *
 *     "I lost count of my rak'ahs"
 *       English only    → Qur'an 7:53                    0.0229
 *       + سجود السهو     → Al-Mughni 1:386-387           0.9229
 *     "does sleeping break my wudu"
 *       English only    → Qur'an 4:43                    0.0231
 *       + نواقض الوضوء   → Majmu' al-Fatawa 21:228-230   0.9268
 *
 * Forty times the score, and the correct chapter instead of a verse that merely
 * mentions the subject. The English half of the query is kept, so the Qur'an
 * arm still matches as before.
 *
 * These name the chapter, not the ruling: `نواقض الوضوء` is the heading the
 * discussion sits under, not a decision about what invalidates ablution.
 */
const PRACTICE: Record<string, string> = {
  // Ablution and purity.
  "break wudu": "نواقض الوضوء",
  "breaks wudu": "نواقض الوضوء",
  // "does getting changed break my wudu" matched none of the three keys above,
  // because the possessive sits between the verb and the noun. Whole-word
  // matching makes a near miss a total miss; the fasting entries already carry
  // both forms for the same reason.
  "break my wudu": "نواقض الوضوء",
  "breaks my wudu": "نواقض الوضوء",
  "invalidates wudu": "نواقض الوضوء",
  wudu: "الوضوء، فرائض الوضوء وسننه",
  "nail polish": "الحائل الذي يمنع وصول الماء إلى البشرة في الوضوء",
  makeup: "الحائل الذي يمنع وصول الماء إلى البشرة",
  cast: "المسح على الجبيرة",
  bandage: "المسح على الجبيرة",
  socks: "المسح على الخفين، مدة المسح للمقيم والمسافر",
  ghusl: "موجبات الغسل، الجنابة",
  istinja: "الاستنجاء بالماء والحجر",
  toilet: "الاستنجاء وآداب قضاء الحاجة",
  najis: "النجاسة وكيفية تطهيرها",
  impure: "النجاسة وكيفية تطهيرها",
  tayammum: "التيمم عند فقد الماء",

  // Prayer.
  "rak'ah": "الركعات، الشك في عدد الركعات",
  rakah: "الركعات، الشك في عدد الركعات",
  "lost count": "الشك في عدد الركعات، سجود السهو",
  "sujud al-sahw": "سجود السهو",
  "prostration of forgetfulness": "سجود السهو",
  congregation: "صلاة الجماعة، الإمام والمأموم",
  "joined late": "المسبوق الذي أدرك بعض الصلاة مع الإمام",
  qibla: "استقبال القبلة",
  witr: "صلاة الوتر",
  tahajjud: "قيام الليل والتهجد",
  "prayer times": "مواقيت الصلاة",
  "missed prayer": "قضاء الفوائت من الصلاة",

  // Fasting.
  "breaks the fast": "مفسدات الصوم، ما يفطر الصائم",
  "break my fast": "مفسدات الصوم، ما يفطر الصائم",
  "breaks my fast": "مفسدات الصوم، ما يفطر الصائم",
  fasting: "الصيام وأحكامه",
  suhoor: "السحور ووقت الإمساك",
  iftar: "وقت الإفطار وغروب الشمس",
  fidyah: "الفدية وإطعام المسكين",
  taraweeh: "قيام رمضان والتراويح",

  // Hajj. `hajj` names the obligation as well as the rites: glossed as مناسك
  // alone it pulled "do I have to do Hajj, and when?" away from Quduri's
  // chapter on when it becomes due and onto the verse naming the hajj months.
  ihram: "الإحرام ومحظوراته",
  tawaf: "الطواف بالبيت",
  hajj: "مناسك الحج، وجوب الحج والاستطاعة",
  umrah: "العمرة وأحكامها",

  // Dress.
  hijab: "عورة المرأة وما يجوز إبداؤه من الزينة",
  niqab: "ستر الوجه وحد العورة",
  headscarf: "عورة المرأة والخمار",
  awrah: "حد العورة",

  // Marriage and family.
  wali: "الولي في النكاح واشتراطه",
  nikah: "عقد النكاح وأركانه والشهود",
  mahr: "المهر والصداق",
  iddah: "العدة بعد الطلاق أو الوفاة",
  "family ties": "صلة الرحم",
  talaq: "الطلاق وأحكامه",

  // Zakat.
  zakat: "الزكاة ونصابها ومصارفها",
  nisab: "نصاب الزكاة",
  // Without this, "do I pay zakat if I'm in debt" reached the nisab chapters
  // and then the verse on giving a debtor respite, but not the question of
  // whether a debt is deducted from the wealth zakat is due on.
  debt: "الدين وأثره في وجوب الزكاة، إسقاط الدين من النصاب",
  loan: "القرض والدين",

  // ---------------------------------------------------------------------
  // Everything below came out of the tier audit over all 469 questions.
  //
  // 109 questions were flagged: a practical question whose best hit was a
  // verse or a tafsir rather than a work of fiqh or hadith. The layer above
  // fired on 3 of them. It was not wrong — it covered purity, prayer,
  // fasting, hajj, dress, marriage and zakat, and those questions came back
  // strong. It simply had nothing to say about creed, food, family, dealings,
  // death, du'a or the occult, which is where most of the bank actually sits.
  //
  // The failure has a signature. Four verses top a disproportionate share of
  // the flagged questions — 2:282, 5:3, 73:20, 2:196 — and they are among the
  // longest in the Qur'an. A long chunk touching many subjects matches
  // weakly against almost anything, so a question with no purchase anywhere
  // else lands there: "does being depressed mean my faith is weak" returned
  // 2:282, the verse on writing down a debt. Naming the chapter gives the
  // question somewhere better to go.
  // ---------------------------------------------------------------------

  // Prayer, beyond the mechanics already covered above.
  pray: "صفة الصلاة، أركان الصلاة وواجباتها",
  prayer: "صفة الصلاة، أركان الصلاة وواجباتها",
  jumuah: "صلاة الجمعة، شروطها والخطبة",
  "jumu'ah": "صلاة الجمعة، شروطها والخطبة",
  "friday prayer": "صلاة الجمعة، شروطها والخطبة",
  duha: "صلاة الضحى",
  "walks in front": "السترة والمرور بين يدي المصلي",
  "mind wanders": "الخشوع في الصلاة والوسوسة فيها",
  incontinence: "سلس البول وصلاة المعذور",
  period: "الحيض والنفاس، ما تتركه الحائض من الصلاة والصوم",
  menstruation: "الحيض والنفاس",
  travelling: "صلاة المسافر وقصر الصلاة",
  traveling: "صلاة المسافر وقصر الصلاة",

  // Fasting.
  "forgot and ate": "الأكل والشرب ناسيا في الصوم",
  "make up": "قضاء رمضان وتأخير القضاء",
  "laylat al-qadr": "ليلة القدر وفضلها وتحريها",
  "long days": "صوم أهل البلاد التي يطول نهارها",

  // Qur'an and recitation.
  recite: "آداب تلاوة القرآن، الجهر والإسرار بالقراءة",
  reciting: "آداب تلاوة القرآن، الجهر والإسرار بالقراءة",
  recitation: "آداب التلاوة واللحن في القراءة",
  translation: "ترجمة معاني القرآن وحكمها",
  mispronounce: "اللحن في القراءة وأثره في الصلاة",

  // Creed. These questions were the worst served of any section: the corpus
  // is full of kalam and tafsir on them, and the English query reached none
  // of it.
  tawhid: "التوحيد وأقسامه، الإيمان بالله",
  qadar: "القضاء والقدر، أفعال العباد",
  decreed: "القضاء والقدر",
  "free will": "أفعال العباد والكسب والاستطاعة",
  suffering: "الابتلاء والصبر والحكمة فيه",
  jinn: "الجن وأحكامهم",
  "names of allah": "أسماء الله الحسنى وإحصاؤها",
  "bid'ah": "البدعة والمحدثات في الدين",
  bidah: "البدعة والمحدثات في الدين",
  madhhab: "التقليد والاجتهاد واتباع المذاهب",
  "scholars disagree": "اختلاف العلماء والترجيح بين الأقوال",
  "leaves islam": "الردة وأحكام المرتد",
  "leaving islam": "الردة وأحكام المرتد",
  "never heard": "أهل الفترة ومن لم تبلغه الدعوة",
  bible: "أهل الكتاب وكتبهم والتوراة والإنجيل",

  // Food and drink.
  alcohol: "الخمر والأشربة المسكرة",
  intoxicants: "الأشربة والمسكرات",
  restaurant: "طعام أهل الكتاب وذبائحهم",
  seafood: "صيد البحر وما يحل من حيوان الماء",
  pork: "لحم الخنزير والميتة وحال الاضطرار",
  "wasting food": "الإسراف والتبذير",
  vegetarian: "إباحة الطيبات وترك ما أحل الله",

  // Dress and the body.
  covering: "ستر العورة وحد ما يجب ستره",
  mahram: "المحارم ومن يجوز النظر إليه",
  tattoos: "الوشم والنمص وتغيير خلق الله",
  tattoo: "الوشم وتغيير خلق الله",
  "hair dye": "الخضاب وصبغ الشعر",
  perfume: "الطيب للمرأة وخروجها به",
  "high heels": "مشية المرأة وما تظهر من زينتها",
  imitating: "التشبه بالكفار",

  // Family.
  parents: "بر الوالدين وطاعتهما، وبر الوالدين الكافرين",
  children: "تربية الأولاد وحضانتهم ونفقتهم",
  aqiqah: "العقيقة وأحكامها",
  adoption: "التبني والدعي واللقيط",
  guardian: "الولي في النكاح واشتراطه",
  "video call": "الإيجاب والقبول واتحاد المجلس، النكاح بالكتاب والرسول",
  "who pays": "النفقة على الزوجة والأولاد",
  "considering marrying": "الخطبة والنظر إلى المخطوبة",

  // Men and women who are not related.
  "opposite gender": "الأجنبية والنظر إليها والخلوة بها",
  "shake hands": "مصافحة الأجنبية",
  hug: "المعانقة والمصافحة",
  cousins: "بنات العم والخال وأنهن غير محارم",

  // Money and dealings.
  interest: "الربا والفوائد المصرفية",
  "student loan": "القرض بفائدة والحاجة والضرورة",
  "student loans": "القرض بفائدة والحاجة والضرورة",
  trade: "البيوع والغش والتدليس",
  business: "البيوع وآداب التجارة",

  // How to behave, which is where the bank is heaviest and the corpus is
  // richest — the adab chapters of every hadith collection.
  "video games": "اللهو واللعب المباح والمنهي عنه",
  gossip: "الغيبة والنميمة",
  backbiting: "الغيبة والنميمة",
  online: "آداب الكلام وحفظ اللسان",
  sport: "السبق والرمي والمسابقة",
  exercise: "السبق والرمي والرياضة البدنية",
  pub: "مجالس الخمر وحضورها",
  gifts: "الهدية لأهل الذمة وقبولها",
  "mother's day": "أعياد الكفار والتشبه بهم",
  "new year": "أعياد الكفار والتشبه بهم",
  celebrate: "الأعياد والتشبه بأهل الملل",
  "explain islam": "الدعوة إلى الله وآدابها",
  hostile: "الصبر على الأذى في الدين",
  salam: "السلام وآدابه وردّه",
  animals: "الرفق بالحيوان وأحكامه",
  neighbours: "حق الجار والإحسان إليه",
  neighbour: "حق الجار",
  slavery: "العتق وأحكام الرقيق",

  // Death.
  died: "الجنائز، غسل الميت والصلاة عليه ودفنه",
  dies: "الجنائز والصلاة على الميت",
  grieving: "التعزية وآدابها",
  condolences: "التعزية",
  will: "الوصية وأحكامها والوصية للوارث",

  // Du'a, repentance and the state of the heart.
  "du'a": "الدعاء وآدابه وشروط الإجابة",
  dua: "الدعاء وآدابه وشروط الإجابة",
  repent: "التوبة وشروطها والاستغفار",
  repentance: "التوبة وشروطها",
  iman: "زيادة الإيمان ونقصانه",
  faith: "الإيمان وزيادته ونقصانه",
  waswas: "الوسوسة والشك في العبادة",
  "intrusive thoughts": "الوسوسة وحديث النفس",
  envy: "الحسد وذمه",
  jealousy: "الحسد والغيرة",
  promise: "الوفاء بالوعد والعهد",
  oath: "الأيمان والنذور وكفارة اليمين",
  depressed: "الهم والحزن والصبر عند البلاء",
  depression: "الهم والحزن والصبر",
  therapist: "التداوي والتماس الأسباب",

  // The occult, which readers ask about far more than the tier tags expected.
  "black magic": "السحر وأحكامه وعقوبة الساحر",
  sihr: "السحر وأحكامه",
  ruqyah: "الرقية الشرعية وشروطها",
  amulets: "التمائم والتولة وتعليقها",
  taweez: "التمائم وتعليقها",
  horoscopes: "التنجيم والكهانة وإتيان العرافين",
  astrology: "التنجيم وأحكامه",

  // Becoming Muslim.
  convert: "إسلام الكافر والنطق بالشهادتين",
  // The worksheet for do-i-have-to-be-circumcised came back entirely about how
  // an apostate re-enters Islam: "circumcised" has no Arabic hook at all, so
  // the query fell through to the nearest convert-adjacent chapter.
  circumcised: "الختان وحكمه وختان الكبير",
  circumcision: "الختان وحكمه وختان الكبير",

  // A second pass over the questions still flagged after the entries above.
  // Almost all of them failed on surface form rather than subject: the entry
  // said "make up" and the reader wrote "making up", the entry said "hair dye"
  // and the reader wrote "dye my hair". Matching is on whole words, so a
  // near-miss is a total miss. Where an entry above already covers the sense,
  // these only add the wording readers actually use.
  "making up": "قضاء الفوائت وقضاء رمضان",
  "missed fasts": "قضاء رمضان وتأخير القضاء",
  "breaking my fast": "الإفطار ووقته وما يقال عنده",
  "can't fast": "العاجز عن الصوم والفدية",
  "cannot fast": "العاجز عن الصوم والفدية",
  fast: "الصيام وأحكامه",
  fasted: "الصيام وأحكامه",
  charity: "الصدقة وأفضلها وآدابها",
  "99 names": "أسماء الله الحسنى وإحصاؤها",
  cover: "ستر العورة ومن تظهر أمامه الزينة",
  dye: "الخضاب وصبغ الشعر",
  "dressing like": "التشبه بالكفار في اللباس",
  "cut off": "قطيعة الرحم وصلة الرحم",
  "savings account": "الوديعة والقرض بفائدة، الربا في المصارف",
  gossiping: "الغيبة والنميمة",
  "group chat": "آداب الكلام وحفظ اللسان",
  friends: "الصحبة واتخاذ الأصدقاء",
  "non-muslim": "أهل الذمة والبر بهم وموالاتهم",
  greet: "السلام وآدابه وردّه",
  "breaking a promise": "إخلاف الوعد والوفاء بالعهد",
  "someone who leaves": "الردة وأحكام المرتد",
};

/**
 * Merged, not overridden. Several terms appear in more than one map — `zakat`
 * is in GLOSS as "the poor-due almsgiving" and in PRACTICE as `الزكاة ونصابها`
 * — and they do different jobs: the English half reaches Pickthall's
 * translation, the Arabic half reaches the fiqh chapters. A plain spread would
 * silently drop whichever came first and take half the retrieval with it.
 */
function merge(maps: Record<string, string>[]): Record<string, string> {
  const all: Record<string, string> = {};
  for (const map of maps) {
    for (const [term, gloss] of Object.entries(map)) {
      all[term] = all[term] ? `${all[term]}, ${gloss}` : gloss;
    }
  }
  return all;
}

// Word boundaries the Unicode-naive `\b` gets wrong around apostrophes, and so
// that "zakatable" or a name like "Salah" inside a longer word is left alone.
const BOUNDARY = String.raw`(?<![\p{L}\p{N}])`;
const BOUNDARY_END = String.raw`(?![\p{L}\p{N}])`;

function compile(all: Record<string, string>) {
  // Longest first, so "savings account" wins over any shorter key inside it.
  const terms = Object.keys(all).sort((a, b) => b.length - a.length);
  return new RegExp(
    BOUNDARY +
      "(" +
      terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
      ")" +
      BOUNDARY_END,
    "giu",
  );
}

const FULL = merge([GLOSS, CONCEPT, PRACTICE]);
const ENGLISH_ONLY = merge([GLOSS, CONCEPT]);

const LAYERS = {
  full: { all: FULL, pattern: compile(FULL) },
  "english-only": { all: ENGLISH_ONLY, pattern: compile(ENGLISH_ONLY) },
} as const;

/**
 * Which layers to apply. `full` is what the app runs.
 *
 * `english-only` drops PRACTICE, and exists so the Arabic layer's effect can be
 * measured rather than assumed: run a question both ways and compare. Absolute
 * rerank scores are not comparable across languages, but the same question
 * scored twice against the same corpus is, and so is a change in which work
 * comes back first.
 */
export type GlossLayers = keyof typeof LAYERS;

/**
 * Append the wording the sources use for any Islamic term or modern concept in
 * the query.
 *
 * Returns the query unchanged when it contains neither, so a question already
 * phrased in the corpus's own vocabulary costs nothing and reads identically.
 */
export function glossQuery(query: string, layers: GlossLayers = "full"): string {
  const { all, pattern } = LAYERS[layers];
  const seen = new Set<string>();
  for (const match of query.matchAll(pattern)) {
    const term = match[1]!.toLowerCase();
    const gloss = all[term];
    if (gloss) seen.add(gloss);
  }
  if (seen.size === 0) return query;
  // Semicolons between expansions: two concepts running together read as one
  // muddled phrase, and "pictures backbiting" is not a thing anyone means.
  return `${query} (${[...seen].join("; ")})`;
}
