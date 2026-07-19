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
  "downloaded", "end", "ends", "especially", "ethics", "even", "examine", "expedient", "explain",
  "fact", "far", "feature", "find", "fine", "first", "follow", "form", "forms", "function",
  "further", "future", "gap", "general", "give", "good", "guided", "happiness", "hence", "him",
  "himself", "however", "https", "human", "inclinations", "incontinence", "incontinent",
  "inherently", "instability", "irwin", "jstor", "jun", "kind", "less", "liable", "live", "love",
  "make", "makes", "may", "mean", "might", "moral", "more", "must", "need", "non", "nothing", "now",
  "obedient", "once", "one", "only", "org", "other", "ought", "our", "out", "outlook", "over",
  "own", "oxford", "part", "particular", "parts", "passage", "passion", "passions", "pay", "people",
  "perhaps", "person", "pleasure", "point", "practical", "present", "presents", "press",
  "prohairesis", "psychology", "pursue", "pursuing", "pursuit", "puzzle", "questions", "rather",
  "rational", "reason", "reconciles", "regret", "remarks", "result", "right", "said", "sake",
  "same", "sat", "satisfaction", "say", "says", "see", "seem", "seems", "self", "should", "simply",
  "since", "sometimes", "sort", "soul", "still", "strategic", "subject", "such", "suggests", "take",
  "terence", "term", "terms", "than", "them", "themselves", "then", "these", "they", "things",
  "though", "try", "two", "types", "understand", "university", "use", "utc", "value", "vice",
  "vices", "vicious", "view", "virtue", "virtues", "virtuous", "way", "ways", "well", "when",
  "which", "who", "will", "without", "would", "wrong", "yet",
];


const IRWIN_ENTITY_TERMS: string[] = [
  "account", "adequacy", "and", "aristotle", "decision", "expedient", "fine", "gap", "instability",
  "moral", "person", "pleasure", "psychology", "pursuing", "reason", "regret", "the", "types",
  "vice", "vicious",
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
    expect(a.signals.topicOverlap).toBeLessThan(0.5);
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

  it("extracts cited surnames from reference entries", () => {
    const s = citedSurnamesFrom([
      "Annas, Julia. \"Plato and Aristotle on Friendship and Altruism.\" Mind 86 (1977).",
      "Broadie, Sarah. Ethics with Aristotle. Oxford, 1991.",
      "   ",
    ]);
    expect(s).toEqual(new Set(["annas", "broadie"]));
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
