/**
 * Hand-implemented classification metrics for judging the claims pipeline
 * against gold-labeled data (see `src/eval/gates.ts` for the pass/fail
 * thresholds these feed, and `src/eval/goldSchema.ts` for the gold data
 * shape). No external stats library — these are small, well-known formulas
 * and this package has zero runtime dependencies by design.
 */

export interface ConfusionMatrix {
  classes: string[];
  /** matrix[i][j] = count of true class i predicted as class j. */
  matrix: number[][];
}

export function confusionMatrix(yTrue: string[], yPred: string[], classes?: string[]): ConfusionMatrix {
  if (yTrue.length !== yPred.length) {
    throw new Error(`yTrue (${yTrue.length}) and yPred (${yPred.length}) must be the same length.`);
  }
  const classList = classes ?? [...new Set([...yTrue, ...yPred])].sort();
  const index = new Map(classList.map((c, i) => [c, i]));
  const matrix = classList.map(() => classList.map(() => 0));

  for (let i = 0; i < yTrue.length; i++) {
    const ti = index.get(yTrue[i]);
    const pi = index.get(yPred[i]);
    if (ti === undefined || pi === undefined) continue; // label outside the given class list — not miscounted
    matrix[ti][pi] += 1;
  }
  return { classes: classList, matrix };
}

export interface PerClassPRF1 {
  className: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export function perClassPRF1(cm: ConfusionMatrix): PerClassPRF1[] {
  return cm.classes.map((className, i) => {
    const truePositive = cm.matrix[i][i];
    const support = cm.matrix[i].reduce((s, n) => s + n, 0);
    const predictedPositive = cm.matrix.reduce((s, row) => s + row[i], 0);
    const precision = predictedPositive === 0 ? 0 : truePositive / predictedPositive;
    const recall = support === 0 ? 0 : truePositive / support;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { className, precision, recall, f1, support };
  });
}

/** Unweighted mean of per-class F1 — every class counts equally regardless
 *  of how common it is, which matters for an imbalanced valence
 *  distribution (unrelated pairs vastly outnumber contradictions). */
export function macroF1(cm: ConfusionMatrix): number {
  const perClass = perClassPRF1(cm);
  if (perClass.length === 0) return 0;
  return perClass.reduce((s, c) => s + c.f1, 0) / perClass.length;
}

/**
 * Cohen's kappa: agreement between two raters (here: predicted vs. gold)
 * beyond what chance alone would produce.
 *   kappa = (observedAgreement - chanceAgreement) / (1 - chanceAgreement)
 */
export function cohenKappa(cm: ConfusionMatrix): number {
  const total = cm.matrix.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  if (total === 0) return 0;

  const observed = cm.matrix.reduce((s, row, i) => s + row[i], 0) / total;

  let chance = 0;
  for (let i = 0; i < cm.classes.length; i++) {
    const rowSum = cm.matrix[i].reduce((s, n) => s + n, 0);
    const colSum = cm.matrix.reduce((s, row) => s + row[i], 0);
    chance += (rowSum / total) * (colSum / total);
  }
  if (chance >= 1) return 0; // degenerate (every prediction/label identical) — avoid dividing by ~0
  return (observed - chance) / (1 - chance);
}

/**
 * Collapses the 4-valence classification into a binary "is this pair
 * actually in tension" question (contradiction/nuance vs. support/unrelated)
 * and reports its F1 — the practically-relevant number when the UI's only
 * job is "flag this pair for a human", regardless of the finer 4-way label.
 */
export function binaryTensionF1(yTrue: string[], yPred: string[]): number {
  const tension = new Set(["contradiction", "nuance"]);
  const toBinary = (labels: string[]) => labels.map((l) => (tension.has(l) ? "tension" : "no_tension"));
  const cm = confusionMatrix(toBinary(yTrue), toBinary(yPred), ["tension", "no_tension"]);
  const tensionRow = perClassPRF1(cm).find((c) => c.className === "tension");
  return tensionRow?.f1 ?? 0;
}

export interface DomainSample {
  domain: string;
  yTrue: string;
  yPred: string;
}

/** Macro-F1 computed separately within each domain (e.g. "empirical" vs.
 *  "humanities") — surfaces a branch-specific regression a single pooled
 *  macro-F1 would average away (see `HUMANITIES_BRANCH_DELTA_MIN` in
 *  `gates.ts`, which this feeds). */
export function perDomainMacroF1(samples: DomainSample[]): Record<string, number> {
  const byDomain = new Map<string, { yTrue: string[]; yPred: string[] }>();
  for (const s of samples) {
    const bucket = byDomain.get(s.domain) ?? { yTrue: [], yPred: [] };
    bucket.yTrue.push(s.yTrue);
    bucket.yPred.push(s.yPred);
    byDomain.set(s.domain, bucket);
  }
  const result: Record<string, number> = {};
  for (const [domain, { yTrue, yPred }] of byDomain) {
    result[domain] = macroF1(confusionMatrix(yTrue, yPred));
  }
  return result;
}
