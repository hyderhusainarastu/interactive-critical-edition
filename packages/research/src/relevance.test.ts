import { describe, expect, it } from "vitest";
import {
  ACCEPT_CONFIDENCE,
  assessCandidate,
  buildTopicSignature,
  citedSurnamesFrom,
  collectCoreMatches,
  laneForResource,
  projectable,
  QUERY_LANES,
  type CandidateVerdict,
  type QueryLane,
  type WorkIdentity,
} from "./relevance";
import type { RawResource } from "./types";

/**
 * Relevance-gate tests built from the Irwin gold-eval fixture
 * (docs/eval/irwin-vice-and-reason/). Every negative case below was ACTUALLY
 * OBSERVED as a false positive returned by a real Crossref or OpenAlex query
 * for this paper's own seed terms on 2026-07-19 — none are invented. That is
 * what makes this suite worth having: it encodes mistakes the pipeline really
 * made, not mistakes we imagined it might make.
 *
 * The vocabularies below were derived by running `buildTopicSignature` over the
 * real fixture text. They are a term list, not reproduced prose.
 */


const IRWIN_TOPIC_TERMS: string[] = [
  "about", "accordance", "account", "act", "acting", "action", "actions", "activity", "acts",
  "adequacy", "advantage", "advantageous", "against", "agree", "aims", "all", "also", "answer",
  "any", "apart", "argument", "aristotle", "attention", "attitude", "basis", "because", "being",
  "best", "between", "book", "both", "can", "cannot", "character", "choice", "choose", "claim",
  "claims", "clear", "conception", "concern", "connexion", "content", "contrast", "control",
  "conviction", "convictions", "correct", "correctly", "decide", "decision", "deliberation",
  "dependent", "description", "desire", "desires", "difference", "different", "difficult",
  "downloaded", "end", "ends", "especially", "ethics", "even", "expedient", "explain", "fact",
  "far", "feature", "find", "fine", "first", "follow", "form", "forms", "function", "further",
  "future", "gap", "general", "give", "good", "guided", "happiness", "hence", "him", "himself",
  "however", "https", "human", "inclinations", "incontinence", "incontinent", "inherently",
  "instability", "irwin", "jstor", "jun", "less", "live", "love", "make", "makes", "may", "mean",
  "might", "moral", "more", "must", "need", "non", "nothing", "now", "obedient", "one", "only",
  "org", "other", "ought", "our", "out", "outlook", "over", "own", "oxford", "part", "particular",
  "parts", "passage", "passion", "passions", "pay", "people", "perhaps", "person", "pleasure",
  "point", "practical", "present", "presents", "press", "prohairesis", "psychology", "pursue",
  "pursuing", "puzzle", "questions", "rather", "rational", "reason", "regret", "remarks", "result",
  "right", "said", "sake", "same", "sat", "satisfaction", "say", "says", "see", "seem", "seems",
  "self", "should", "simply", "since", "sometimes", "sort", "soul", "still", "strategic", "subject",
  "such", "suggests", "take", "terence", "term", "terms", "than", "them", "themselves", "then",
  "these", "they", "things", "though", "try", "two", "types", "understand", "university", "use",
  "utc", "value", "vice", "vices", "vicious", "view", "virtue", "virtues", "virtuous", "way",
  "ways", "well", "when", "which", "who", "will", "without", "would", "wrong", "yet",
];


const IRWIN_ENTITY_TERMS: string[] = [
  "aquinas", "aris", "aristotle", "bywater", "cooper", "david", "nicomachean", "plato", "rhetoric",
  "rogers", "ufe",
];

const IRWIN_CORE_CONCEPTS = [
  "vice", "vicious", "reason", "rational", "prohairesis", "decision", "kalon", "fine",
  "akrasia", "incontinence", "incontinent", "regret", "self-love", "expedient", "pleasure",
  "virtue", "virtuous", "temperance", "intemperance", "cowardice", "sloth",
];

const irwin: WorkIdentity = {
  title: "Vice and Reason",
  authors: ["Terence Irwin"],
  year: 2001,
  doi: "10.1023/A:1011416908374",
  topicTerms: IRWIN_TOPIC_TERMS,
  entityTerms: IRWIN_ENTITY_TERMS,
  coreConceptTerms: IRWIN_CORE_CONCEPTS,
  // Annas 1977 is cited by name in Irwin's own note 2.
  explicitCitationKeys: new Set(["doi:10.1093/mind/lxxxvi.344.532"]),
  citedAuthorSurnames: new Set(["annas", "hampton", "broadie", "aquinas", "cooper"]),
  citationGraphKeys: new Set(),
};

/** Minimal RawResource builder — only the fields the gate reads. */
const R = (p: Partial<RawResource> & { title: string }): RawResource => ({
  provider: "crossref",
  resourceType: "article",
  authors: [],
  year: null,
  url: null,
  doi: null,
  isbn: null,
  snippet: null,
  venue: null,
  popularity: null,
  raw: null,
  ...p,
});

const verdict = (c: RawResource, lane: QueryLane): CandidateVerdict =>
  assessCandidate(c, irwin, lane).verdict;

// ---------------------------------------------------------------- positives

describe("relevance gate — genuinely relevant scholarship is accepted", () => {
  const accepted: Array<[string, RawResource, QueryLane]> = [
    ["Müller, 'Aristotle on Vice'", R({ title: "Aristotle on Vice", authors: ["Jozef Müller"], doi: "10.1080/09608788.2015.1022855", venue: "British Journal for the History of Philosophy" }), "scholarly_debate"],
    ["Brickhouse 2003", R({ title: "Does Aristotle Have a Consistent Account of Vice?", authors: ["Thomas C. Brickhouse"], url: "https://www.jstor.org/stable/20131936", venue: "The Review of Metaphysics" }), "scholarly_debate"],
    ["Nielsen 2017", R({ title: "Vice in the Nicomachean Ethics", authors: ["Karen Margrethe Nielsen"], doi: "10.1163/15685284-12341317", venue: "Phronesis" }), "scholarly_debate"],
    ["Elliott 2016 (names Irwin explicitly)", R({ title: "Reply to Müller: Aristotle on vicious choice", authors: ["Jay R. Elliott"], doi: "10.1080/09608788.2016.1225567", venue: "British Journal for the History of Philosophy" }), "scholarly_debate"],
    ["Roochnik 2007", R({ title: "Aristotle's Account of the Vicious: A Forgivable Inconsistency", authors: ["David Roochnik"], url: "https://philpapers.org/rec/ROOAAO", venue: "History of Philosophy Quarterly" }), "scholarly_debate"],
    ["Solis 2025", R({ title: "Curable and Incurable Vice in Aristotle", authors: ["Eric Solis"], doi: "10.5840/ancientphil202545116", venue: "Ancient Philosophy" }), "scholarly_debate"],
    ["Moss 2011", R({ title: "'Virtue Makes the Goal Right': Virtue and Phronesis in Aristotle's Ethics", authors: ["Jessica Moss"], doi: "10.1163/156852811X575907", venue: "Phronesis" }), "parallel_literature"],
    ["Irwin on kalon (author corpus)", R({ title: "The Sense and Reference of Kalon in Aristotle", authors: ["Terence Irwin"], doi: "10.1086/657027", venue: "Classical Philology" }), "author_corpus"],
  ];

  it.each(accepted)("accepts %s", (_name, candidate, lane) => {
    expect(verdict(candidate, lane)).toBe("accepted");
  });

  it("accepts an explicit citation outright, even on thin topical overlap", () => {
    // Annas 1977 is about friendship and altruism — its title shares little
    // with this paper's vocabulary. It is in only because Irwin actually cites
    // it, which is the strongest signal there is.
    const a = assessCandidate(
      R({ title: "Plato and Aristotle on Friendship and Altruism", authors: ["Julia Annas"], doi: "10.1093/mind/LXXXVI.344.532", venue: "Mind" }),
      irwin,
      "explicit_citation",
    );
    expect(a.verdict).toBe("accepted");
    expect(a.confidence).toBe(1);
    expect(a.reasons).toContain("explicit_citation_match");

    // Prove it is the citation doing the work: strip the citation evidence and
    // the same record no longer qualifies on its own merits.
    const uncited: WorkIdentity = { ...irwin, explicitCitationKeys: new Set(), explicitCitationTexts: [] };
    expect(assessCandidate(
      R({ title: "Plato and Aristotle on Friendship and Altruism", authors: ["Julia Annas"], doi: "10.1093/mind/LXXXVI.344.532", venue: "Mind" }),
      uncited,
      "scholarly_debate",
    ).verdict).not.toBe("accepted");
  });
});

// ------------------------------------------------- public sources: both ways

describe("relevance gate — public sources face the same relevance bar", () => {
  it("accepts a genuinely on-topic expert lecture", () => {
    const a = assessCandidate(
      R({ provider: "youtube", resourceType: "video", title: "Aristotle: Ethics and the Virtues — vice, reason and character", authors: ["Angie Hobbs"], url: "https://www.youtube.com/watch?v=example", venue: "Royal Institute of Philosophy" }),
      irwin,
      "lecture_course",
    );
    expect(a.verdict).toBe("accepted");
    expect(a.signals.coreConceptMatches).toEqual(expect.arrayContaining(["vice", "reason"]));
  });

  it("rejects generic high-view media that merely name-drops a concept", () => {
    // Observed in the reference brief's own methodology section. Millions of
    // views; nothing to say about Irwin's thesis.
    const a = assessCandidate(
      R({ provider: "youtube", resourceType: "video", title: "Aristotle & Virtue Theory: Crash Course Philosophy #38", authors: ["CrashCourse"], url: "https://www.youtube.com/watch?v=example2", popularity: 3_000_000 }),
      irwin,
      "video_podcast",
    );
    expect(a.verdict).toBe("rejected");
  });

  it("never lets popularity raise a verdict", () => {
    const base = R({ provider: "youtube", resourceType: "video", title: "Aristotle & Virtue Theory: Crash Course Philosophy #38", authors: ["CrashCourse"], url: "https://www.youtube.com/watch?v=example2" });
    const unpopular = assessCandidate({ ...base, popularity: 3 }, irwin, "video_podcast");
    const viral = assessCandidate({ ...base, popularity: 90_000_000 }, irwin, "video_podcast");
    expect(viral.verdict).toBe(unpopular.verdict);
    expect(viral.confidence).toBe(unpopular.confidence);
  });
});

// ---------------------------------------------------------------- negatives

describe("relevance gate — observed false positives never reach the reader", () => {
  const negatives: Array<[string, RawResource, QueryLane]> = [
    ["a marketing paper that ranked FIRST for a core seed query", R({ title: "Coolhunting, account planning and the ancient cool of Aristotle", authors: ["Nick Southgate"], doi: "10.1108/02634500310504304", venue: "Marketing Intelligence & Planning" }), "scholarly_debate"],
    ["Aristotle meets Shakespeare", R({ title: "Taking Excess, Exceeding Account: Aristotle Meets Shakespeare", authors: ["Spencer"], doi: "10.1057/9781403982469_10", venue: "Money and the Age of Shakespeare" }), "scholarly_debate"],
    ["a World Bank development paper", R({ title: "What Does Political Economy Tell Us about Economic Development?", authors: ["Keefer"], doi: "10.1596/1813-9450-3250" }), "scholarly_debate"],
    ["Heidegger on equipment", R({ title: "Repeating Metaphysics: Heidegger's Account of Equipment", authors: ["Sinclair"], doi: "10.1057/9780230625075_3" }), "parallel_literature"],
    ["Ross on right acts", R({ title: "W. D. Ross: What Makes Right Acts Right?", doi: "10.4324/9780203723746-50" }), "parallel_literature"],
    ["right author, right journal, WRONG work", R({ title: "Mens rea", authors: ["Jean Hampton"], doi: "10.1017/s0265052500000741", venue: "Social Philosophy and Policy" }), "scholarly_debate"],
    ["a title-word collision on 'Immorality'", R({ title: "Degradation, Pornography, and Immorality", authors: ["Strasser"], doi: "10.5840/socphiltoday1990478" }), "scholarly_debate"],
  ];

  it.each(negatives)("never accepts %s", (_name, candidate, lane) => {
    expect(verdict(candidate, lane)).not.toBe("accepted");
  });

  it("rejects an author collision where the surname is someone else's GIVEN name", () => {
    // Observed: an OpenAlex author search for "Terence Irwin" returned a Cell
    // paper co-authored by *Irwin Olsen*. A shared name is not an identity.
    const a = assessCandidate(
      R({ title: "Stem Cell Function, Self-Renewal, and Behavioral Heterogeneity", authors: ["Charlotte Collins", "Irwin Olsen"], venue: "Cell" }),
      irwin,
      "author_corpus",
    );
    expect(a.verdict).toBe("rejected");
    expect(a.reasons).toContain("author_collision_given_name");
    // "self-love" must not tokenize into "self" and match "Self-Renewal".
    expect(a.signals.coreConceptMatches).toEqual([]);
  });

  it("rejects a marketing venue on a no-core-concept candidate", () => {
    const a = assessCandidate(
      R({ title: "Coolhunting, account planning and the ancient cool of Aristotle", doi: "10.1108/02634500310504304", venue: "Marketing Intelligence & Planning" }),
      irwin,
      "scholarly_debate",
    );
    expect(a.verdict).toBe("rejected");
    expect(a.signals.venueLooksOffDiscipline).toBe(true);
    expect(a.venueReliable).toBe(false);
  });
});

// ------------------------------------------- canary regressions (production)

describe("relevance gate — a shared concept WORD is not a shared subject", () => {
  // All of these were accepted by a real production run over the Irwin
  // fixture, whose core concepts were "vice" and "reason". Both words are
  // polysemous and common, so matching on them alone admitted consumer
  // research, epistemology, political theory and constitutional law —
  // 74 accepted at roughly 16% precision. Requiring a shared named entity is
  // what separates the subject from the vocabulary.
  const falsePositives: Array<[string, RawResource]> = [
    ["consumer research on 'vice goods'", R({ title: "Variety, Vice, and Virtue: How Assortment Size Influences Option Choice", venue: "Journal of Consumer Research" })],
    ["organic-product purchasing", R({ title: "Willingness to pay for organic products: Differences between virtue and vice foods" })],
    ["epistemology's 'epistemic vice'", R({ title: "Vice Epistemology", venue: "The Monist" })],
    ["motivation in epistemic vice", R({ title: "Epistemic Vice and Motivation", venue: "Metaphilosophy" })],
    ["political theory's 'public reason'", R({ title: "Public Reason in Hobbes" })],
    ["Kant on public reason", R({ title: "Kant on Public Reason" })],
    ["critical theory", R({ title: "Algorithmic Reason" })],
    ["historiography", R({ title: "Ordinary Historical Reason" })],
    ["political economy", R({ title: "Ordoliberalism and the Crisis of Reason" })],
    ["constitutional law", R({ title: "Disobedience of Constitutional Court Decision as a Reason for Impeachment of the President" })],
    ["business ethics", R({ title: "Vice and Virtue in Everyday (Business) Life" })],
    ["comparative religion", R({ title: "Combinations of reason and tradition in Islamic ethics" })],
    ["a bare token", R({ title: "Vice Versa" })],
  ];

  it.each(falsePositives)("never accepts %s", (_name, candidate) => {
    const a = assessCandidate(candidate, irwin, "scholarly_debate");
    expect(a.verdict).not.toBe("accepted");
  });

  it("still accepts the same concepts when the work's own subject is named", () => {
    // The control: identical concept words, but genuinely about this subject.
    for (const title of [
      "Aristotle on Vice",
      "Vice in the Nicomachean Ethics",
      "Vice in ancient philosophy: Plato and Aristotle on moral character",
    ]) {
      expect(assessCandidate(R({ title }), irwin, "scholarly_debate").verdict).toBe("accepted");
    }
  });
});

// -------------------------------------------------------------- recall paths

describe("relevance gate — recall without losing precision", () => {
  it("reads entity evidence from the abstract when the title names no one", () => {
    // Observed in the canary: Hume's section on "the use of reason concerning
    // virtue and vice" is squarely on-subject but its title names nobody, so a
    // title-only entity rule quarantined it.
    const a = assessCandidate(
      R({
        title: "Section IV. Showing the use of reason concerning virtue and vice",
        snippet: "Hume's answer to the rationalists, developed against Aristotle's account of moral virtue and the mean.",
      }),
      irwin,
      "historical_background",
    );
    expect(a.verdict).toBe("accepted");
  });

  it("does not let a name-dropping abstract rescue an off-subject title", () => {
    // The abstract mentions Aristotle; the paper is still about consumer
    // choice. A passing mention is not evidence of subject, so the title must
    // itself be substantially on-vocabulary before context counts.
    const a = assessCandidate(
      R({
        title: "Variety, Vice, and Virtue: How Assortment Size Influences Option Choice",
        venue: "Journal of Consumer Research",
        snippet: "We draw loosely on Aristotle's distinction between virtue and vice to frame consumer self-control.",
      }),
      irwin,
      "scholarly_debate",
    );
    expect(a.verdict).not.toBe("accepted");
  });

  it("recognises a citation from an abbreviated reference entry via author+year", () => {
    // Reference entries routinely abbreviate or line-wrap a title. Demanding
    // near-total title containment against them was losing genuine citations —
    // the one category that must never be lost. Author AND year agreeing is
    // independent corroboration, so a substantial title overlap suffices.
    const withRefs: WorkIdentity = {
      ...irwin,
      explicitCitationTexts: [
        'Julia Annas, "Plato and Aristotle on Friendship," Mind 86 (1977), pp. 532-554.',
      ],
    };
    const a = assessCandidate(
      R({ title: "Plato and Aristotle on Friendship and Altruism", authors: ["Julia Annas"], year: 1977 }),
      withRefs,
      "scholarly_debate",
    );
    expect(a.signals.isExplicitCitation).toBe(true);
    expect(a.verdict).toBe("accepted");
  });

  it("still refuses author+year corroboration when the title disagrees", () => {
    const withRefs: WorkIdentity = {
      ...irwin,
      explicitCitationTexts: ["Julia Annas, \"Plato and Aristotle on Friendship and Altruism,\" Mind 86 (1977)."],
    };
    const a = assessCandidate(
      R({ title: "Ancient Scepticism and the Sceptical Tradition", authors: ["Julia Annas"], year: 1977 }),
      withRefs,
      "scholarly_debate",
    );
    expect(a.signals.isExplicitCitation).toBe(false);
  });
});

// --------------------------------------------------------------- quarantine

describe("relevance gate — uncertainty quarantines rather than guessing", () => {
  it("quarantines same-field, different-subject work by a cited author", () => {
    // Annas on deontic 'ought' in the NE: genuinely Aristotle's Ethics, by an
    // author this paper cites — but not about vice or reason. Accepting it
    // would pollute the reader; rejecting it would discard a real lead.
    const a = assessCandidate(
      R({ title: "'Ought' in Aristotle's Nicomachean Ethics", authors: ["Julia Annas"], doi: "10.1093/oso/9780198817277.003.0011" }),
      irwin,
      "scholarly_debate",
    );
    expect(a.verdict).toBe("quarantined");
    expect(a.reasons).toContain("no_core_concept_match");
    expect(a.signals.groundingSignals).toContain("cited_author");
  });

  it("quarantines an adjacent-topic paper with no evidenced link", () => {
    const a = assessCandidate(
      R({ title: "On Becoming Fearful Quickly: A Reinterpretation of Aristotle's Account of Courage", authors: ["Brian Lightbody"], doi: "10.11606/issn.1981-9471.v17i2p134-161", venue: "Journal of Ancient Philosophy" }),
      irwin,
      "parallel_literature",
    );
    expect(a.verdict).toBe("quarantined");
  });

  it("quarantines a high-confidence candidate that has no independent grounding", () => {
    // Confidence alone must never be sufficient — rule 4 requires BOTH.
    const bare: WorkIdentity = { ...irwin, entityTerms: [], citedAuthorSurnames: new Set() };
    const a = assessCandidate(R({ title: "Vice and Reason" }), { ...bare, coreConceptTerms: [] }, "parallel_literature");
    expect(a.verdict).not.toBe("accepted");
  });
});

// ------------------------------------------------------- mis-indexed records

describe("relevance gate — degrades a bad FIELD, not a whole RECORD", () => {
  it("keeps a genuinely authored work whose venue is mis-indexed", () => {
    // Observed: OpenAlex indexes an Irwin/Nussbaum Vlastos festschrift under
    // "Medical Entomology and Zoology". Rejecting on venue would lose a real
    // author-corpus work; trusting the venue would publish nonsense.
    const a = assessCandidate(
      R({ title: "Virtue, Love and Form: Essays in Memory of Gregory Vlastos", authors: ["Terence Irwin", "Martha C. Nussbaum"], venue: "Medical Entomology and Zoology" }),
      irwin,
      "author_corpus",
    );
    expect(a.verdict).toBe("accepted");
    expect(a.venueReliable).toBe(false);
    expect(a.reasons).toContain("off_discipline_venue_flagged");
  });
});

// ------------------------------------------------------------- gate wiring

describe("relevance gate — structural guarantees", () => {
  it("only accepted candidates are projectable downstream", () => {
    const rows = [
      { id: "a", verdict: "accepted" as const },
      { id: "b", verdict: "quarantined" as const },
      { id: "c", verdict: "rejected" as const },
    ];
    expect(projectable(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("assigns exactly one verdict per candidate, deterministically", () => {
    const c = R({ title: "Aristotle on Vice", doi: "10.1080/09608788.2015.1022855" });
    const first = assessCandidate(c, irwin, "scholarly_debate");
    const second = assessCandidate(c, irwin, "scholarly_debate");
    expect(second).toEqual(first);
    expect(["accepted", "quarantined", "rejected"]).toContain(first.verdict);
  });

  it("rejects a candidate with no usable identity rather than inventing one", () => {
    const a = assessCandidate(R({ title: "" }), irwin, "scholarly_debate");
    expect(a.verdict).toBe("rejected");
    expect(a.reasons).toContain("unusable_identity");
    expect(a.normalizedKey).toBeNull();
  });

  it("covers all twelve discovery lanes", () => {
    expect(QUERY_LANES).toHaveLength(12);
    for (const lane of QUERY_LANES) {
      expect(verdict(R({ title: "Aristotle on Vice", doi: "10.1080/09608788.2015.1022855" }), lane)).toBeDefined();
    }
  });

  it("matches multi-word core concepts as phrases, not as loose tokens", () => {
    expect(collectCoreMatches(["self", "renewal"], ["self-love"], "Stem Cell Self-Renewal")).toEqual([]);
    expect(collectCoreMatches(["love"], ["self-love"], "Aristotle on self-love and regret")).toEqual(["self-love"]);
  });

  it("never admits an author's own name as a core concept", () => {
    // Caught by a production canary: before metadata is confirmed the work
    // title is filename-derived ("Irwin-ViceReason-2001.pdf" → "Irwin
    // ViceReason 2001"), which made "irwin" a core concept. The gate then
    // accepted "Gage, Irwin", "Bazelon, Irwin" and "Irwin, John" as on-topic.
    const sig = buildTopicSignature({
      title: "Irwin ViceReason 2001",
      authors: ["Terence Irwin"],
    });
    expect(sig.coreConceptTerms).not.toContain("irwin");
    expect(sig.coreConceptTerms).not.toContain("terence");

    const leaky: WorkIdentity = {
      ...irwin,
      title: "Irwin ViceReason 2001",
      coreConceptTerms: sig.coreConceptTerms,
      entityTerms: sig.entityTerms,
      topicTerms: sig.topicTerms,
      citedAuthorSurnames: new Set(),
    };
    for (const title of ["Gage, Irwin", "Bazelon, Irwin", "Irwin, John"]) {
      expect(assessCandidate(R({ title }), leaky, "scholarly_debate").verdict).not.toBe("accepted");
    }
  });

  it("drops numeric extraction artifacts from the topic signature", () => {
    // Real PDFs carry access furniture ("downloaded from 172.226.191.27").
    const sig = buildTopicSignature({
      title: "Vice and Reason",
      bodyText: "172 172 172 172 172 172 vice vice vice vice vice vice",
    });
    expect(sig.topicTerms).not.toContain("172");
    expect(sig.topicTerms).toContain("vice");
  });

  it("recognises an explicit citation from an unresolved reference entry", () => {
    // Most reference-list entries never resolve to a DOI. Matching on the
    // entry text is what stops the pipeline from treating a work the author
    // actually cites as an unvetted stranger.
    const withRefs: WorkIdentity = {
      ...irwin,
      explicitCitationTexts: [
        "Julia Annas, \"Plato and Aristotle on Friendship and Altruism,\" Mind 86 (1977), pp. 532-554.",
        "Sarah Broadie, Ethics with Aristotle (Oxford: Oxford University Press, 1991), p. 177n41.",
      ],
    };
    const a = assessCandidate(
      R({ title: "Ethics with Aristotle", authors: ["Sarah Broadie"], year: 1991 }),
      withRefs,
      "scholarly_debate",
    );
    expect(a.verdict).toBe("accepted");
    expect(a.reasons).toContain("explicit_citation_match");
  });

  it("does not promote a different work by a cited author to an explicit citation", () => {
    // Irwin's note 2 cites Hampton's "The Nature of Immorality". Crossref also
    // returns Hampton's "Mens rea" from the adjacent issue of the same journal.
    // Right author, right venue, wrong work — it must not ride in on the
    // citation entry.
    const withRefs: WorkIdentity = {
      ...irwin,
      explicitCitationTexts: [
        'Jean Hampton, "The Nature of Immorality," in E.F. Paul, D. Miller and J. Paul (eds.), Foundations of Moral and Political Philosophy (Oxford: Blackwell, 1990), pp. 22-44, at pp. 29-31.',
      ],
    };
    const a = assessCandidate(
      R({ title: "Mens rea", authors: ["Jean Hampton"], venue: "Social Philosophy and Policy" }),
      withRefs,
      "scholarly_debate",
    );
    expect(a.signals.isExplicitCitation).toBe(false);
    expect(a.verdict).not.toBe("accepted");

    // …while the work Irwin actually cites IS recognised from the same entry.
    const real = assessCandidate(
      R({ title: "The Nature of Immorality", authors: ["Jean Hampton"] }),
      withRefs,
      "scholarly_debate",
    );
    expect(real.signals.isExplicitCitation).toBe(true);
    expect(real.verdict).toBe("accepted");
  });

  it("extracts cited names whichever order the reference style uses", () => {
    // Reference styles disagree about name order, and taking only the leading
    // token collected given names instead of surnames. Observed in production:
    // the set held "Sarah" rather than "Broadie", silently weakening every
    // check that depends on knowing whom the document cites.
    const s = citedSurnamesFrom([
      'Annas, Julia. "Plato and Aristotle on Friendship and Altruism." Mind 86 (1977).',
      "Sarah Broadie, Ethics with Aristotle (Oxford: Oxford University Press, 1991).",
      "See W.F.R. Hardie, Aristotle's Ethical Theory, ed. 2 (Oxford, 1980).",
      "   ",
    ]);
    expect(s).toContain("annas");
    expect(s).toContain("broadie");
    expect(s).toContain("hardie");
    // The leading cue word is not a name.
    expect(s).not.toContain("see");
  });

  it("routes resources to a defensible lane", () => {
    expect(laneForResource({ provider: "crossref", resourceType: "article", venue: null, url: null }, false)).toBe("scholarly_debate");
    expect(laneForResource({ provider: "crossref", resourceType: "book", venue: null, url: null }, false)).toBe("primary_prerequisite");
    expect(laneForResource({ provider: "bluesky", resourceType: "social_post", venue: null, url: null }, false)).toBe("public_discussion");
    expect(laneForResource({ provider: "youtube", resourceType: "video", venue: "Royal Institute of Philosophy", url: null }, false)).toBe("lecture_course");
    expect(laneForResource({ provider: "youtube", resourceType: "video", venue: "CrashCourse", url: null }, false)).toBe("video_podcast");
    // An explicit citation always wins, whatever the medium.
    expect(laneForResource({ provider: "youtube", resourceType: "video", venue: "CrashCourse", url: null }, true)).toBe("explicit_citation");
  });

  it("requires acceptance to clear the documented confidence threshold", () => {
    const a = assessCandidate(
      R({ title: "Aristotle on Vice", doi: "10.1080/09608788.2015.1022855", venue: "British Journal for the History of Philosophy" }),
      irwin,
      "scholarly_debate",
    );
    expect(a.confidence).toBeGreaterThanOrEqual(ACCEPT_CONFIDENCE);
  });
});

// ------------------------------------------- canary 5 regressions (production)

describe("relevance gate — canary 5 false positives", () => {
  it("does not match a core concept buried in a hyphenated compound", () => {
    // Observed: "Aspiring Vice-Chancellors' Rhetoric and the Challenges of
    // Building..." matched the core concept "vice" through "Vice-Chancellors",
    // and the entity "rhetoric" through Aristotle's Rhetoric. Both words are
    // present; neither concept is.
    const a = assessCandidate(
      R({ title: "2 - Aspiring Vice-Chancellors' Rhetoric and the Challenges of Building a University" }),
      irwin,
      "concept_doctrine",
    );
    expect(a.signals.coreConceptMatches).not.toContain("vice");
    expect(a.verdict).not.toBe("accepted");
  });

  it("still matches the concept when the word stands alone", () => {
    expect(collectCoreMatches([], ["vice"], "Aristotle on Vice")).toEqual(["vice"]);
    expect(collectCoreMatches([], ["vice"], "Vice, Reason, and Character")).toEqual(["vice"]);
    expect(collectCoreMatches([], ["vice"], "The Vice-Chancellor's Report")).toEqual([]);
  });

  it("requires two shared concepts before trusting an abstract name-drop", () => {
    // Observed: "'Public Reason' and Moral Debate" shared only "reason" and was
    // admitted by an abstract that mentioned Aristotle in passing.
    const a = assessCandidate(
      R({ title: "'Public Reason' and Moral Debate", snippet: "Rawlsian public reason, contrasted with Aristotle on practical wisdom." }),
      irwin,
      "scholarly_debate",
    );
    expect(a.verdict).not.toBe("accepted");
  });
});

// ------------------------------------------------ single-word title recall

describe("relevance gate — a distinctive one-word title can still be a citation", () => {
  // Irwin cites J. A. Smith, "Aristotelica," Classical Quarterly 14 (1920).
  // "Aristotelica" is one token, and the two-token floor made it unmatchable
  // however strong the corroboration — the outstanding miss that held
  // explicit-citation recall at ~88%. Crossref returns that exact work as the
  // top hit for the query already sent, so it was never source coverage.
  const smithEntry = 'J.A. Smith, "Aristotelica," Classical Quarterly 14 (1920), pp. 1-8.';

  it("matches a distinctive one-word title corroborated by author and year", () => {
    const withRefs: WorkIdentity = { ...irwin, explicitCitationTexts: [smithEntry] };
    const a = assessCandidate(
      R({ title: "Aristotelica", authors: ["J. A. Smith"], year: 1920, venue: "The Classical Quarterly" }),
      withRefs,
      "explicit_citation",
    );
    expect(a.signals.isExplicitCitation).toBe(true);
    expect(a.verdict).toBe("accepted");
  });

  it("refuses a one-word title without both corroborating signals", () => {
    const withRefs: WorkIdentity = { ...irwin, explicitCitationTexts: [smithEntry] };
    // Right title, wrong year — corroboration is incomplete.
    expect(
      assessCandidate(R({ title: "Aristotelica", authors: ["J. A. Smith"], year: 1998 }), withRefs, "explicit_citation")
        .signals.isExplicitCitation,
    ).toBe(false);
    // Right title and year, but the entry does not name that author.
    expect(
      assessCandidate(R({ title: "Aristotelica", authors: ["Someone Else"], year: 1920 }), withRefs, "explicit_citation")
        .signals.isExplicitCitation,
    ).toBe(false);
  });

  it("refuses a short generic one-word title even when fully corroborated", () => {
    // "Ethics" is a word many works share; admitting it would let any book of
    // that name ride in on a matching author and year.
    const withRefs: WorkIdentity = {
      ...irwin,
      explicitCitationTexts: ["Terence Irwin, Ethics, Hackett (2001), p. 12."],
    };
    expect(
      assessCandidate(R({ title: "Ethics", authors: ["Terence Irwin"], year: 2001 }), withRefs, "scholarly_debate")
        .signals.isExplicitCitation,
    ).toBe(false);
  });
});

describe("relevance gate — short distinctive canonical titles in citation entries", () => {
  it("accepts Nicomachean Ethics from the explicit-citation lane even when provider metadata omits Aristotle", () => {
    const withRefs: WorkIdentity = {
      ...irwin,
      explicitCitationTexts: [
        "Aristotle, Nicomachean Ethics I.7, II.1-6, III.1-5, VII.1-10, IX.4 and IX.8.",
      ],
    };
    const a = assessCandidate(
      R({ title: "Nicomachean Ethics", authors: [], year: null }),
      withRefs,
      "explicit_citation",
    );
    expect(a.signals.isExplicitCitation).toBe(true);
    expect(a.reasons).toContain("explicit_citation_match");
    expect(a.verdict).toBe("accepted");
  });

  it("accepts a concise canonical title from the explicit-citation query without accepting articles merely about it", () => {
    const withRefs: WorkIdentity = {
      ...irwin,
      explicitCitationTexts: ["Nicomachean Ethics"],
    };
    const canonical = assessCandidate(
      R({ title: "Nicomachean Ethics", authors: [], year: null }),
      withRefs,
      "explicit_citation",
    );
    const commentary = assessCandidate(
      R({ title: "Particularism in Aristotle’s Nicomachean Ethics", authors: [], year: null }),
      withRefs,
      "explicit_citation",
    );

    expect(canonical.signals.isExplicitCitation).toBe(true);
    expect(canonical.verdict).toBe("accepted");
    expect(commentary.signals.isExplicitCitation).toBe(false);
    expect(commentary.verdict).not.toBe("accepted");
  });

  it("accepts a concise canonical title when the explicit-citation lane finds an exact document phrase", () => {
    const withText: WorkIdentity = {
      ...irwin,
      explicitCitationTexts: [],
      documentTextForExplicitTitleMatch:
        "In Nicomachean Ethics (EN), I 7 he argues that happiness is an activity of what has reason.",
    };
    const canonical = assessCandidate(
      R({ title: "Nicomachean Ethics", authors: [], year: null }),
      withText,
      "explicit_citation",
    );
    const commentary = assessCandidate(
      R({ title: "Particularism in Aristotle’s Nicomachean Ethics", authors: [], year: null }),
      withText,
      "explicit_citation",
    );

    expect(canonical.signals.isExplicitCitation).toBe(true);
    expect(canonical.verdict).toBe("accepted");
    expect(commentary.signals.isExplicitCitation).toBe(false);
    expect(commentary.verdict).not.toBe("accepted");
  });
});
