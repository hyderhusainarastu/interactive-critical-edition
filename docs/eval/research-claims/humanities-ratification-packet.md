# Humanities gold-set ratification packet (Lane L5, Phase 27.3)

*Owner review document. Generated from `packages/claims/src/eval/gold/{relationshipPairs.humanities.json, retrievalNegatives.json, claimNature.json, RATIFICATION.md}` — every card below is a faithful, unedited reproduction of the underlying JSON record (claim text, sources, loci, rationale). No content has been paraphrased or invented.*

## 1. What this unlocks

Phase 27 (Synthesis) has two sub-phases already shipped in production — 27.1 Evidence Chamber and 27.2 hypotheses/gaps — and one still gated: **27.3, the humanities judge gate**. Today, any claim-relationship pair drawn from a humanities work is routed through the base 4-way empirical judge with `interpretive` flagged as a category, never silently misclassified into a wrong valence — a deliberate, safe placeholder. 27.3 replaces that placeholder with a purpose-built humanities branch (definitional/interpretive nuance mechanisms — `mechanismDraft` values like `different_scope_conditions`, `different_definition`, `interprets_differently` — from `taxonomy.ts`'s stage-2 labeling) and applies migration `0046` (an enum widening for the extended relationship vocabulary), but **only on a passing eval run against gold data you have reviewed**. That eval cannot run against `provisional: true` drafts — this packet is the review step standing between here and that gate.

**"Ratify" means, per record:** read the claim text and rationale against the cited source, then either (a) confirm the label/`mechanismDraft`/`category` are correct and flip `"provisional": true` → `"provisional": false`, (b) correct a label/category/mechanism that's wrong but the record itself is sound, or (c) delete the record outright if it doesn't hold up. Nothing is gold, and nothing gates on it, until `provisional: false`.

**The four promotion floors** the 27.3 eval will check once ratification is done (`packages/claims/src/eval/gates.ts`):

| Floor | Threshold | What it measures |
|---|---|---|
| `HUMANITIES_BRANCH_DELTA_MIN` | ≤ 0.05 macro-F1 gap | The humanities branch's judge accuracy must land within 0.05 macro-F1 of the already-validated empirical branch — new territory doesn't get a free pass on quality. |
| `CLAIM_NATURE_MACRO_F1_MIN` | ≥ 0.65 macro-F1 | The 8-value `claim_nature` taxonomy (textual/interpretive/definitional/normative/conceptual/historical/empirical/methodological) must classify well enough to trust, deliberately looser than the core valence gates since nature is a softer task. |
| `MECHANISM_ACCURACY_MIN` | ≥ 0.60 accuracy | Stage-2 `mechanismDraft` labeling (why a pair looks contradictory but isn't) is optional metadata, not the core verdict, so it clears a lower bar. |
| `EMPIRICAL_REGRESSION_MAX` | ≤ 0.02 macro-F1 drop | Adding the humanities branch must not measurably hurt the empirical-paper judging Phase 25's calibration spike already validated. |

(A fifth, general-purpose floor, `MIN_GOLD_PER_VALUE = 6`, governs whether any *individual* class/value has enough gold examples to trust its own per-class number — this is the ">=6 floor" referenced against the claim-nature groups in Section 3 below.)

---
## 2. Relationship pairs — `relationshipPairs.humanities.json` (36 records)

Every claim pair is drawn from the Aristotle-on-vice/akrasia corpus (domain `ancient_philosophy` throughout). Records are grouped by draft label below; within each group they appear in their original `hum_NNN` order. A ⚠️ flags a record where either (a) both claims are sourced from the same work — suspicious for what is meant to be a cross-source relationship pair — or (b) the rationale itself uses hedging language. A programmatic hedge-word scan (`may`, `might`, `seems`, `likely`, `possibly`, `suggests`, `unclear`, etc.) found **zero** hedging hits in any of the 36 rationales, so every ⚠️ below is a same-work flag.

### Contradiction (7 records, 1 flagged)

#### `hum_009` — category: interpretive · split: train

- **Claim A** — *Bostock, Aristotle's Ethics* (section: interpretive, confidence: high)
  > Aristotle's descriptions of the fully vicious person in NE VII and NE IX.4 are genuinely inconsistent and cannot be reconciled as one settled character type.
- **Claim B** — *Brickhouse, Does Aristotle Have a Consistent Account of Vice?* (section: interpretive, confidence: high)
  > A vicious person's Book VII harmony and Book IX.4 conflict can be reconciled once the two portraits are read as describing different temporal stages of one developing character.
- **Rationale:** The two positions are opposed on the central question of whether Aristotle's account of vice is coherent: Bostock affirms genuine inconsistency, Brickhouse denies it via reconciliation.

#### `hum_010` — category: interpretive · split: test

- **Claim A** — *Müller, Aristotle on Vice* (section: interpretive, confidence: high)
  > The vicious person lacks any stable, unified rational conception of the good; his apparent commitments merely track whatever pleasure is present, so 'principled vice' overstates the coherence Aristotle attributes to vicious character.
- **Claim B** — *Nielsen, Vice in the Nicomachean Ethics* (section: interpretive, confidence: high)
  > Vice is best understood as a settled, general commitment to a false or corrupted conception of the good, arrived at through mistaken practical reasoning rather than a decision-by-decision failure.
- **Rationale:** Nielsen explicitly argues that Müller's unprincipled-agent account cannot accommodate Aristotle's technical choice and wish claims; the two positions are directly opposed characterizations of the vicious agent's psychology.

#### `hum_011` ⚠️ — category: textual · split: train

- **Claim A** — *Aristotle, Nicomachean Ethics VII* (section: textual, confidence: high)
  > At NE VII 1150a21-31, the fully vicious, intemperate person is incurable and pursues excess without regret, having no ongoing struggle against his own settled state.
- **Claim B** — *Aristotle, Nicomachean Ethics IX.4* (section: textual, confidence: high)
  > At NE IX.4 1166b19-25, the vicious person's soul is torn between two parts, one pained and one pleased by the same recollected act, and such people are said to be full of regret.
- **Rationale:** Taken at face value the two loci attribute opposite psychological states (unregretful harmony vs regretful conflict) to the same kind of agent; this raw textual tension is the datum the whole VII/IX.4 debate addresses.
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_012` — category: interpretive · split: train

- **Claim A** — *Brickhouse, Does Aristotle Have a Consistent Account of Vice?* (section: interpretive, confidence: high)
  > A vicious person's apparent Book VII harmony and Book IX.4 conflict can be reconciled by reading them as different temporal stages of one developing character, driven by growing appetite that eventually defeats his plan for pleasure.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > This developmental reconciliation should be rejected: it has no explicit textual basis, understates the intensity of Book IX.4's self-loathing, and conflicts with Book VII's description of the intemperate agent as not requiring an overpowering appetite.
- **Rationale:** Roochnik directly rejects Brickhouse's account on three stated grounds (pp.213-214), an explicit REJECTS relationship, not a milder disagreement.

#### `hum_013` — category: interpretive · split: test

- **Claim A** — *Annas, Plato and Aristotle on Friendship and Altruism* (section: interpretive, confidence: medium)
  > Book IX.4's conflicted, regretful portrait of vice may reflect an earlier stage of composition, locally influenced by the Platonic Lysis, and not yet fully integrated with Book VII's psychology.
- **Claim B** — *Nielsen, Vice in the Nicomachean Ethics* (section: interpretive, confidence: high)
  > Vice admits a unified, non-chronological, systematic account across both books; no compositional or developmental conclusion about an early, unintegrated passage is established by the evidence.
- **Rationale:** Annas's chronological/local-Platonizing hypothesis and Nielsen's systematic, non-chronological account are opposed on whether the VII/IX.4 tension requires (or supports) any compositional explanation at all.

#### `hum_014` — category: interpretive · split: train

- **Claim A** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > The fully unregretful, harmonious Book VII vicious agent risks sliding into the very brutish, monstrous category that Aristotle's own typology treats as distinct from ordinary vice.
- **Claim B** — *Nielsen, Vice in the Nicomachean Ethics* (section: interpretive, confidence: high)
  > Vice, properly understood, is a fully human, corrigible failure of practical reasoning about the good, continuous with ordinary moral psychology rather than a brutish or inhuman condition.
- **Rationale:** Roochnik's dehumanization worry (pp.216-217, ARG-009) and Nielsen's systematic, humanizing account of vice reach opposite verdicts on how alien or monstrous the vicious agent's psychology is.

#### `hum_015` — category: interpretive · split: train

- **Claim A** — *Irwin, Vice and Reason* (section: interpretive, confidence: high)
  > In vice, practical reason remains active but subordinated to antecedent inclination, giving the vicious agent a genuine, if corrupted, rational structure.
- **Claim B** — *Müller, Aristotle on Vice* (section: interpretive, confidence: high)
  > The vicious person lacks any stable, unified rational conception of the good; his apparent commitments merely track whatever pleasure is present.
- **Rationale:** Müller's account is a documented, explicit challenge to harmonizing, principled readings of vice like Irwin's instrumental-reason solution -- it denies the vicious soul is principled or harmonious at all.

### Nuance (15 records, 9 flagged)

#### `hum_016` ⚠️ — category: textual · split: test

- **Claim A** — *Aristotle, Nicomachean Ethics VII* (section: textual, confidence: high)
  > At NE VII 1148a17-18, Aristotle describes the intemperate person as pursuing excessive pleasures without desire, or with only weak desire, for them.
- **Claim B** — *Aristotle, Nicomachean Ethics VII* (section: textual, confidence: high)
  > Elsewhere Aristotle attributes real appetite to the intemperate person, confirming that vicious pursuit of pleasure is desire-driven rather than a purely rational calculation performed without desire at all.
- **Rationale:** Roochnik reconciles the two loci (1148a17-18 and 1119a1) by reading 'without desire' as excluding only desire strong enough to overpower correct reason, not desire as such (pp.209-210).
- **mechanismDraft:** `different_scope_conditions`
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_017` — category: interpretive · split: train

- **Claim A** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > NE VII's unregretful intemperate person and NE IX.4's remorseful vicious person cannot straightforwardly describe one and the same stable character type at a single moment.
- **Claim B** — *Brickhouse, Does Aristotle Have a Consistent Account of Vice?* (section: interpretive, confidence: high)
  > A vicious person can be internally harmonious and unregretful at one stage, then become conflicted and regretful once his increasing appetite for pleasure begins to defeat his own settled plan for maximal pleasure.
- **Rationale:** Brickhouse relativizes the two portraits to different temporal stages of one developing character rather than treating them as simultaneous claims about one fixed type (Roochnik pp.212-214 reporting Brickhouse).
- **mechanismDraft:** `different_scope_conditions`

#### `hum_018` — category: interpretive · split: train

- **Claim A** — *Solis, Curable and Incurable Vice in Aristotle* (section: interpretive, confidence: high)
  > An incurable form of vice matches Book VII's unregretful intemperate portrait, and a curable form of vice matches Book IX.4's regretful portrait -- two genuinely distinct varieties rather than one inconsistently described type.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > Book VII and Book IX.4 offer two incompatible descriptions of the same kind of fully vicious agent, not descriptions of two different kinds of vice.
- **Rationale:** Solis redefines 'vice' as covering two distinct sub-kinds so there is no single referent to be inconsistently described, which dissolves the presupposition behind Roochnik's inconsistency reading (SRC-030, CON-030).
- **mechanismDraft:** `different_definition`

#### `hum_019` — category: interpretive · split: test

- **Claim A** — *Aristotle, Nicomachean Ethics VII.1* (section: textual, confidence: high)
  > Aristotle's sixfold moral typology places brutishness in a category entirely outside vice, structurally paired against superhuman virtue.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > The fully unregretful, harmonious vicious person of Book VII risks sliding toward the very brutish, monstrous category that the typology treats as distinct from ordinary vice.
- **Rationale:** Roochnik does not deny the formal typological boundary; he interprets the psychological stability of that boundary differently, arguing it is felt as unstable by the ethical reader even though the categories remain formally distinct (pp.216-217).
- **mechanismDraft:** `interprets_differently`

#### `hum_020` — category: interpretive · split: train

- **Claim A** — *Annas, Plato and Aristotle on Friendship and Altruism* (section: interpretive, confidence: medium)
  > Book IX.4's conflicted, regretful portrait of vice may reflect an earlier stage of composition, locally influenced by the Platonic Lysis, not yet fully integrated with Book VII's psychology.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > The two portraits do not fit together, but the mismatch should not be treated as a mere compositional accident; holding both descriptions in view serves a genuine philosophical purpose.
- **Rationale:** Roochnik partially agrees with Annas's diagnosis of a mismatch but declines her chronological explanation, offering a philosophical-functional explanation instead; the two differ on what KIND of explanation the mismatch calls for, not on whether a mismatch exists.
- **mechanismDraft:** `different_definition`

#### `hum_021` ⚠️ — category: definitional · split: train

- **Claim A** — *Aristotle, Nicomachean Ethics IX.4 and IX.8* (section: textual, confidence: high)
  > The virtuous person is a friend to himself (philautos) in the good sense, since his rational and non-rational parts agree and he wishes himself well.
- **Claim B** — *Aristotle, Nicomachean Ethics IX.8* (section: textual, confidence: medium)
  > Aristotle also recognizes a blameworthy sense of self-love, the sense the many assign themselves through selfish pursuit of gain, pleasure, and honor rather than genuine self-friendship.
- **Rationale:** 'Philautia' is equivocal in Aristotle between a proper, virtuous sense and a popular, blameworthy sense; the apparent tension dissolves once the two senses of the same term are distinguished (baseline CON-020).
- **mechanismDraft:** `different_definition`
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_022` ⚠️ — category: interpretive · split: test

- **Claim A** — *Irwin, Vice and Reason* (section: interpretive, confidence: high)
  > Irwin explains vice as arising when practical reason continues operating but is subordinated to the pursuit of the expedient (sumpheron) rather than the fine (kalon), which properly governs the virtuous agent's choices.
- **Claim B** — *Irwin, Vice and Reason* (section: limitations, confidence: high)
  > Irwin cautions that this fine/expedient account fits vices such as cowardice, intemperance, and sloth more naturally than vices such as greed, vindictiveness, or the desire for power and domination, where the model is harder to apply.
- **Rationale:** Irwin himself states the scope caveat as a self-imposed narrowing of his own mechanism's range, not a retraction of it (per the fixture's arg-scope-caveat, section 11).
- **mechanismDraft:** `different_scope_conditions`
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_023` ⚠️ — category: methodological · split: train

- **Claim A** — *Irwin, Vice and Reason* (section: interpretive, confidence: high)
  > Irwin's instrumental-reason account explains why the vicious person still deliberates and forms plans despite pursuing bad ends, preserving a recognizably rational structure in vicious action.
- **Claim B** — *Irwin, Vice and Reason* (section: methods, confidence: high)
  > Irwin explicitly acknowledges that in supplying this account of vice he develops Aristotle's own remarks well beyond anything Aristotle himself explicitly says.
- **Rationale:** The epistemic hedge (fixture arg-self-admission, section 8 opening) qualifies the evidentiary status of the instrumental-reason mechanism without negating the mechanism itself.
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_024` — category: interpretive · split: train

- **Claim A** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > Because the akratic person regrets his wrongdoing once his judgment reasserts itself, his failure shows he retains genuine concern for the good, unlike the settled vicious person.
- **Claim B** — *Aristotle, Nicomachean Ethics III* (section: textual, confidence: high)
  > Despite this retained concern for the good, Aristotle treats the akratic person's wrongful actions as voluntary and blameworthy, not as an excusable lapse.
- **Rationale:** The baseline material flags exactly this as a common beginner error -- inferring that regret erases blame -- which Roochnik's own reading (p.207) does not license (ARG-002).

#### `hum_025` ⚠️ — category: definitional · split: test

- **Claim A** — *Aristotle, Nicomachean Ethics VII* (section: textual, confidence: high)
  > Giving in to anger is more pardonable, on Aristotle's account, than giving in to appetite for pleasure, because anger is closer to reason and 'listens' to it in a way appetite does not.
- **Claim B** — *Aristotle, Nicomachean Ethics VII* (section: textual, confidence: high)
  > Even so, yielding to anger still counts as a form of akrasia -- a failure to act on one's own correct judgment -- and is not thereby moved outside the category of self-mastery failure.
- **Rationale:** The pardon Aristotle extends for anger-driven wrongdoing is a matter of degree within akrasia, not an exemption from it (PAS-025 through PAS-030).
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_026` ⚠️ — category: textual · split: train

- **Claim A** — *Aristotle, Nicomachean Ethics VII.1* (section: textual, confidence: high)
  > Aristotle's sixfold moral typology treats continence and incontinence (akrasia) as a pair distinct from virtue and vice, implying akrasia is not itself a form of vice.
- **Claim B** — *Aristotle, Nicomachean Ethics VII* (section: textual, confidence: high)
  > Elsewhere Aristotle says akrasia is 'in some way' vice, and that one can perform unjust acts through akrasia without thereby being an unjust person.
- **Rationale:** The 'in some way' qualifier at 1151a6-15 marks a partial, qualified sense of vice-likeness that does not collapse the formal sixfold distinction drawn at 1145a16-19.
- **mechanismDraft:** `different_scope_conditions`
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_027` — category: methodological · split: train

- **Claim A** — *Aristotle, Nicomachean Ethics I.3* (section: textual, confidence: high)
  > Aristotle warns that ethical inquiry should seek only the precision its subject matter allows, not the exactness proper to mathematics.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > Roochnik nonetheless treats the question of whether Books VII and IX.4 are logically consistent as a determinate textual and philosophical question with a real answer, not one dissolved by an appeal to inexactness.
- **Rationale:** The inexactness principle bears on the precision of substantive ethical judgments about action, not on whether a determinate answer exists to a question of logical consistency in Aristotle's own exposition.
- **mechanismDraft:** `different_scope_conditions`

#### `hum_028` ⚠️ — category: historical · split: test

- **Claim A** — *Homer, Odyssey XI* (section: narrative, confidence: high)
  > In Odyssey XI, the shades of the ordinary dead are insubstantial, force-less, dream-like images (eidola) without real embodiment.
- **Claim B** — *Homer, Odyssey XI* (section: narrative, confidence: high)
  > The same book of the Odyssey shows Tityos, Tantalus, and Sisyphus undergoing vivid, ongoing bodily punishment in the underworld.
- **Rationale:** Homer applies 'nearly nothing' to the ordinary dead's presence, while the punished sinners are a marked exception whose animate suffering is precisely what makes deserved punishment intelligible (PAS-044 through PAS-048).
- **mechanismDraft:** `different_scope_conditions`
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_029` ⚠️ — category: interpretive · split: train

- **Claim A** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > Roochnik's central conclusion is that Aristotle's inconsistent portraits of vice are forgivable, because together they capture something true about how radical vice appears to an ethical reader.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > Roochnik explicitly denies that his argument licenses treating philosophical inconsistency as generally harmless or acceptable; the forgivable verdict is narrowly scoped to this specific case.
- **Rationale:** Part Four (pp.217-218) states the forgivability verdict is scoped to this one philosophical case, not generalized into a license for contradiction.
- **mechanismDraft:** `different_scope_conditions`
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_030` ⚠️ — category: textual · split: train

- **Claim A** — *Aristotle, Nicomachean Ethics III* (section: textual, confidence: high)
  > Aristotle treats the akratic person's wrongdoing as voluntary, since he retains correct judgment and chooses to act despite it.
- **Claim B** — *Aristotle, Nicomachean Ethics VII* (section: textual, confidence: high)
  > Aristotle nonetheless allows a qualified pardon (syngnome) for akratic wrongdoing that follows a natural impulse like anger, distinguishing it from wrongdoing that follows appetite for excess.
- **Rationale:** Voluntariness and blameworthiness (1111a25-b4) are compatible with a degree of pardon scoped to the source of the impulse -- anger versus appetite -- not to voluntariness itself (1149b4, CON-014, CON-015).
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

### Support (8 records, 1 flagged)

#### `hum_001` — category: interpretive · split: train

- **Claim A** — *Bostock, Aristotle's Ethics* (section: interpretive, confidence: high)
  > Aristotle's descriptions of the fully vicious person in NE VII and NE IX.4 cannot both describe one settled, stable character type; the two portraits are genuinely inconsistent.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > The Book VII intemperate agent's unregretful harmony and the Book IX.4 vicious agent's regretful inner conflict cannot be reconciled as descriptions of the same fixed character; the tension is real, not merely apparent.
- **Rationale:** Roochnik explicitly adopts Bostock's inconsistency diagnosis (Roochnik p.212, n.12); both scholars reach the same verdict on the VII/IX.4 mismatch.

#### `hum_002` — category: historical · split: train

- **Claim A** — *Homer, Odyssey XI* (section: narrative, confidence: high)
  > Homer's underworld in Odyssey XI presents the dead as nearly nothing -- insubstantial shades without real embodiment -- yet capable of fear and of suffering deserved punishment, an inconsistency Homer leaves unresolved.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > Aristotle's two incompatible portraits of the vicious person are best explained, not resolved, because holding both in view captures how a genuinely alien moral possibility appears to an ethically decent reader.
- **Rationale:** Roochnik's Homeric excursus (pp.214-216) functions as an explicit argumentative analogy for his forgivable-inconsistency conclusion (pp.214-218), not as decorative context.

#### `hum_003` — category: textual · split: train

- **Claim A** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > The Book VII intemperate agent should not be read as literally lacking desire; Aristotle elsewhere attributes real appetite to the intemperate person, so the 'without desire' language must exclude only desire strong enough to overpower correct reason.
- **Claim B** — *Irwin, Vice and Reason* (section: interpretive, confidence: high)
  > In vice, practical reason remains active rather than absent; it becomes subordinated to antecedent inclination and operates strategically rather than as the authoritative source of the agent's ends.
- **Rationale:** Both readings converge on the same underlying point: neither reason nor desire is simply switched off in the vicious agent (Roochnik pp.209-210 on NE VII 1148a17-18/1119a1; Irwin's instrumental-reason solution, sections 5-7).

#### `hum_004` — category: interpretive · split: test

- **Claim A** — *Nielsen, Vice in the Nicomachean Ethics* (section: interpretive, confidence: high)
  > Vice is best understood as a settled, general commitment to a corrupted conception of the good, arrived at through mistaken practical reasoning, not a mere decision-by-decision failure.
- **Claim B** — *Barney, Becoming Bad: Aristotle on Vice and Moral Habituation* (section: interpretive, confidence: high)
  > Vice arises through habituation, a reason-corrupting process of becoming bad that produces a stable corrupted state of character, distinct from a single akratic lapse.
- **Rationale:** Both accounts affirm vice as a settled, principled corruption of practical reason rather than an unprincipled appetite-driven failure; Barney's habituation account contextualizes the same corrupted-reason picture Nielsen defends (per baseline SRC-028 CONTEXTUALIZES CON-013).

#### `hum_005` — category: interpretive · split: train

- **Claim A** — *Aristotle, Nicomachean Ethics I.4* (section: textual, confidence: high)
  > Aristotle requires that a student of ethics already possess decent habits before ethics can be properly studied; this audience condition is explicit in the text.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > Because the ethical reader already cares about being good, the fully vicious agent of Book VII remains partly unintelligible to that reader even after the two portraits are laid side by side.
- **Rationale:** Roochnik's closing reader-position claim (pp.217-218, ARG-010) is presented as a direct consequence of NE I.4 1095b4-6's habituation requirement, not a rival claim.

#### `hum_006` ⚠️ — category: textual · split: train

- **Claim A** — *Aristotle, Nicomachean Ethics III* (section: textual, confidence: high)
  > Aristotle holds that the akratic person's wrongful actions are voluntary, since he is not compelled and retains the capacity to have acted otherwise.
- **Claim B** — *Aristotle, Nicomachean Ethics VII* (section: textual, confidence: high)
  > Aristotle compares the akratic person's inactive knowledge to a sleeping, mad, or drunk person's use of correct words without genuine understanding, explaining how voluntary wrongdoing coexists with dormant moral knowledge.
- **Rationale:** The sleep-metaphor passages (1147a13-1147b7) supply the mechanism behind the voluntariness claim at 1109b30-1111b4 rather than conflicting with it; both are premises in the same VII argument (PAS-006, PAS-020/021).
- ⚠️ **Flag:** Claim A and Claim B are sourced from the **same work** (both cite the same underlying text) — verify this is an intentional internal-tension/self-consistency pair, not a mismatched cross-work comparison.

#### `hum_007` — category: interpretive · split: test

- **Claim A** — *Irwin, Vice and Reason* (section: interpretive, confidence: high)
  > There is a real interpretive puzzle in Aristotle: the vicious, like the virtuous, act on decision (prohairesis), which implies rational guidance, even though Aristotle elsewhere associates vice with living according to passion rather than reason.
- **Claim B** — *Roochnik, Aristotle's Account of the Vicious* (section: interpretive, confidence: high)
  > The Book VII intemperate agent acts through settled choice on a corrupted principle; he is not a passion-driven eruption that simply overwhelms reason.
- **Rationale:** Irwin's opening puzzle-statement and Roochnik's own reading of the Book VII intemperate agent (pp.208-210) independently converge on treating vice as choice-guided rather than a mere appetitive eruption.

#### `hum_008` — category: interpretive · split: train

- **Claim A** — *Brickhouse, Does Aristotle Have a Consistent Account of Vice?* (section: interpretive, confidence: high)
  > A vicious person's Book VII harmony and Book IX.4 conflict can be reconciled if his settled plan for maximal pleasure is later disrupted by growing appetite, generating conflict and regret only at that later stage.
- **Claim B** — *Irwin, Aristotle's Nicomachean Ethics (2nd ed. commentary)* (section: interpretive, confidence: high)
  > Book IX.4's regret can be explained along similar lines: it arises once the vicious person's earlier plan for pleasure begins to fail.
- **Rationale:** Roochnik reports that Irwin 'is cited as moving in a similar direction' to Brickhouse's developmental reconciliation (Part Three commentary, n.16); both scholars offer the same reconciliation strategy.

### Unrelated (6 records, 0 flagged)

#### `hum_031` — category: methodological · split: test

- **Claim A** — *Roochnik, Aristotle's Account of the Vicious* (section: methods, confidence: high)
  > Roochnik translates the Nicomachean Ethics himself, using Ingram Bywater's 1962 Oxford reprint of the Greek text as his base edition.
- **Claim B** — *Aristotle, Nicomachean Ethics IX.4* (section: textual, confidence: high)
  > The virtuous person is a friend to himself because his rational and non-rational parts are in agreement, wishing himself well and enjoying his own company.
- **Rationale:** An edition-choice/translation detail (n.3) and a substantive self-friendship claim (1166a10-13) have no logical relationship to each other.

#### `hum_032` — category: methodological · split: train

- **Claim A** — *Perseus Digital Library, Nicomachean Ethics text tool* (section: methods, confidence: high)
  > The Perseus Digital Library provides an aligned Greek/English reading interface used to check Bekker-referenced Nicomachean Ethics passages against a critical edition.
- **Claim B** — *Homer, Odyssey XI* (section: narrative, confidence: high)
  > Homer's Odyssey XI presents an inconsistent underworld where nearly insubstantial shades nonetheless fear and suffer deserved punishment.
- **Rationale:** A digital-tooling/verification detail and a substantive Homeric interpretive claim are unrelated -- one is infrastructure, the other content.

#### `hum_033` — category: methodological · split: train

- **Claim A** — *Roochnik, Aristotle's Account of the Vicious* (section: acknowledgements, confidence: high)
  > Roochnik credits an extended conversation with Anna Lannstrom for originating the idea behind his paper, and Steve Esposito for Homeric background information.
- **Claim B** — *Nielsen, Vice in the Nicomachean Ethics* (section: interpretive, confidence: high)
  > Vice is best understood as a settled commitment to a false, corrupted conception of the good arrived at through mistaken practical reasoning.
- **Rationale:** A provenance/acknowledgements note about one paper's origins and a different scholar's substantive thesis about vice bear no logical relationship.

#### `hum_034` — category: methodological · split: test

- **Claim A** — *Liddell, Scott, Jones and McKenzie, A Greek-English Lexicon (9th ed.)* (section: methods, confidence: high)
  > The Liddell-Scott-Jones Greek-English Lexicon's ninth edition, revised with Roderick McKenzie, was published by Oxford's Clarendon Press in 1940.
- **Claim B** — *Brickhouse, Does Aristotle Have a Consistent Account of Vice?* (section: interpretive, confidence: high)
  > A vicious person can be internally harmonious at one time and later conflicted once growing appetite defeats a plan for maximal pleasure.
- **Rationale:** A lexicon's publication-history detail and Brickhouse's substantive reconciliation claim have no logical bearing on one another.

#### `hum_035` — category: methodological · split: train

- **Claim A** — *PhilPapers record for Roochnik (2007)* (section: reception metadata, confidence: high)
  > PhilPapers' indexed record for Roochnik's paper lists nine citing works as of the 2026 research check, including Muller (2015), Nielsen (2017), Barney (2020), and Solis (2025).
- **Claim B** — *Aristotle, Nicomachean Ethics IX.4* (section: textual, confidence: high)
  > In Book IX.4, Aristotle describes the vicious person's soul as torn between two parts, one pained and one pleased by the same recollected act.
- **Rationale:** A citation-count metadata fact and a substantive textual claim about the vicious person's psychology are unrelated in content.

#### `hum_036` — category: methodological · split: train

- **Claim A** — *Lattimore (trans.), The Odyssey of Homer* (section: methods, confidence: high)
  > Roochnik credits Richmond Lattimore's 1991 translation of the Odyssey for the Homeric passages he quotes.
- **Claim B** — *Barney, Becoming Bad: Aristotle on Vice and Moral Habituation* (section: interpretive, confidence: high)
  > Vice arises through habituation, a reason-corrupting process of becoming bad that is distinct from a single akratic lapse.
- **Rationale:** A translation-credit detail and Barney's substantive habituation thesis have no logical relationship to each other.

## 3. Claim-nature records — `claimNature.json` (65 records)

Single-claim records for the 8-value `claim_nature` taxonomy gate (`CLAIM_NATURE_MACRO_F1_MIN = 0.65`, `packages/claims/src/eval/gates.ts`). Each nature group must clear the `MIN_GOLD_PER_VALUE = 6` floor to be trusted for its own per-class metric.

### Textual (9 records — ✅ clears >=6 floor)

#### `nat_001`

- **Claim:** At NE VII 1145b11-14, Aristotle first characterizes akrasia as a condition to be examined alongside continence, endurance, and softness.
- **Source:** Aristotle, Nicomachean Ethics VII, 1145b11-14
- **Rationale:** States what a specific locus literally introduces, with no interpretive claim layered on top.

#### `nat_002`

- **Claim:** At NE VII 1146b22-24, the intemperate person is said to act on choice and to think that present pleasure ought always to be pursued.
- **Source:** Aristotle, Nicomachean Ethics VII, 1146b22-24
- **Rationale:** A direct report of what the passage says about the intemperate agent's choice and belief.

#### `nat_003`

- **Claim:** At NE IX.4 1166b19-25, Aristotle describes the vicious soul as torn, with one part pained and another pleased by the same past act, and says such people are full of regret.
- **Source:** Aristotle, Nicomachean Ethics IX.4, 1166b19-25
- **Rationale:** A direct textual report of the IX.4 conflict passage central to the whole VII/IX.4 debate.

#### `nat_004`

- **Claim:** At NE VII 1150a21-31, Aristotle discusses whether akratic wrongdoing is curable and compares chronic akrasia to a disease.
- **Source:** Aristotle, Nicomachean Ethics VII, 1150a21-31
- **Rationale:** Reports the content of a specific passage about curability without adding interpretation.

#### `nat_005`

- **Claim:** At NE I.3 1094b24-25, Aristotle states that a well-educated person seeks only as much precision in a subject as its nature allows.
- **Source:** Aristotle, Nicomachean Ethics I.3, 1094b24-25
- **Rationale:** A direct report of the ethical-precision passage's content.

#### `nat_006`

- **Claim:** At NE VII.1 1145a16-19, Aristotle lays out a sixfold typology of character: superhuman virtue, virtue, continence, incontinence, vice, and brutishness.
- **Source:** Aristotle, Nicomachean Ethics VII.1, 1145a16-19
- **Rationale:** Reports the structural content of the typology passage itself.

#### `nat_007`

- **Claim:** At NE IX.8 1169a12, Aristotle notes that 'philautos' (friend to oneself) is a term some apply pejoratively to selfish people, while a positive sense is reserved for the genuinely virtuous.
- **Source:** Aristotle, Nicomachean Ethics IX.8, 1169a12
- **Rationale:** A direct report of the passage's dual usage of philautos.

#### `nat_008`

- **Claim:** Irwin's paper opens by stating a textual puzzle: Aristotle's vicious agents act on decision (prohairesis), which implies rational guidance, yet Aristotle elsewhere says they live according to passion rather than reason.
- **Source:** Irwin, Vice and Reason, opening/abstract
- **Rationale:** Reports what the paper's own opening states as the textual puzzle it addresses, without endorsing a solution.

#### `nat_009`

- **Claim:** Homer's Odyssey XI.393 and 475-491 describes Achilles' shade lamenting that he would rather be a poor man's living slave than rule over all the dead.
- **Source:** Homer, Odyssey XI.393, 475-491
- **Rationale:** A direct report of the Achilles-lament passage's content, cited by Roochnik as part of the Hades analogy.

### Interpretive (9 records — ✅ clears >=6 floor)

#### `nat_010`

- **Claim:** Aristotle's two portraits of the vicious person in Books VII and IX.4 are genuinely inconsistent yet philosophically forgivable, because together they capture a difficult truth about how radical vice appears to an ethical reader.
- **Source:** Roochnik, Aristotle's Account of the Vicious
- **Rationale:** Roochnik's own thesis, an interpretive verdict about the text rather than a report of what the text literally says.

#### `nat_011`

- **Claim:** Aristotle's descriptions of the fully vicious person in Books VII and IX.4 cannot be reconciled as descriptions of one settled character type.
- **Source:** Bostock, Aristotle's Ethics
- **Rationale:** An interpretive verdict about textual coherence, not a report of a single passage's content.

#### `nat_012`

- **Claim:** Aristotle can be given a consistent account of vice if the Book VII and Book IX.4 portraits are read as describing different temporal stages of one developing vicious character.
- **Source:** Brickhouse, Does Aristotle Have a Consistent Account of Vice?
- **Rationale:** A reconciliation strategy proposed by the scholar, going beyond what either passage states on its own.

#### `nat_013`

- **Claim:** The vicious person lacks a stable, unified rational conception of the good, so 'principled vice' overstates the coherence Aristotle attributes to vicious character.
- **Source:** Muller, Aristotle on Vice
- **Rationale:** An interpretive characterization of the vicious agent's psychology, contested by other scholars.

#### `nat_014`

- **Claim:** Vice is best understood as a settled commitment to a corrupted conception of the good, arrived at through mistaken practical reasoning.
- **Source:** Nielsen, Vice in the Nicomachean Ethics
- **Rationale:** A general interpretive thesis synthesizing multiple passages, not a report of one locus.

#### `nat_015`

- **Claim:** An incurable form of vice matches Book VII, and a curable form matches Book IX.4, treating them as genuinely distinct varieties rather than one inconsistently described type.
- **Source:** Solis, Curable and Incurable Vice in Aristotle
- **Rationale:** A reconciling interpretive move that redefines the scope of 'vice' to resolve the apparent tension.

#### `nat_016`

- **Claim:** In vice, practical reason remains active but becomes subordinated to antecedent inclination, functioning strategically rather than authoritatively over ends.
- **Source:** Irwin, Vice and Reason
- **Rationale:** Irwin's own solution to the puzzle he poses, an interpretive construction rather than a direct textual report.

#### `nat_017`

- **Claim:** Book IX.4's conflicted portrait of vice may reflect an earlier stage of composition, locally influenced by the Platonic Lysis.
- **Source:** Annas, Plato and Aristotle on Friendship and Altruism
- **Rationale:** A compositional-historical interpretive hypothesis, not a claim about a passage's literal content.

#### `nat_018`

- **Claim:** Vice is the outcome of habituation, a reason-corrupting process of becoming bad distinct from a single akratic lapse.
- **Source:** Barney, Becoming Bad: Aristotle on Vice and Moral Habituation
- **Rationale:** An interpretive synthesis of the habituation material across NE II and VII.

### Definitional (8 records — ✅ clears >=6 floor)

#### `nat_019`

- **Claim:** 'Akrasia' denotes a failure to act on one's own better judgment under the pull of appetite or emotion, distinct from ignorance and from settled vice.
- **Source:** Baseline glossary CON-004, per Aristotle NE VII
- **Rationale:** A working definition of a key term, not a claim about a specific passage or a scholarly thesis.

#### `nat_020`

- **Claim:** 'Syngnome' ranges in sense across acknowledgment, fellow-feeling, allowance, excuse, and pardon, with no single fixed modern equivalent.
- **Source:** Liddell, Scott, Jones and McKenzie, A Greek-English Lexicon (9th ed.), s.v. syngnome
- **Rationale:** A lexical-semantic claim about a term's range of meaning, sourced from a lexicon rather than an argument.

#### `nat_021`

- **Claim:** 'Prohairesis' denotes deliberative choice arrived at through prior deliberation about means to an already-wished-for end, not a momentary urge or bare intention.
- **Source:** Irwin gold-eval fixture, expectedConcepts
- **Rationale:** A definitional gloss of a technical term central to the vice/akrasia distinction.

#### `nat_022`

- **Claim:** 'Kalon,' the fine or the noble, names the end for the sake of which the virtuous agent, but not the vicious agent, characteristically chooses.
- **Source:** Irwin, Vice and Reason
- **Rationale:** A definitional claim about a term's role in the theory, distinct from the interpretive mechanism built on it.

#### `nat_023`

- **Claim:** 'Akolasia' is variously rendered as intemperance, self-indulgence, licentiousness, or lack of restraint, and each translation foregrounds a different modern psychological model.
- **Source:** Baseline glossary CON-006
- **Rationale:** A claim about translation options and their differing connotations, a definitional/lexical matter.

#### `nat_024`

- **Claim:** 'Philautia,' self-love, is equivocal in Aristotle between a blameworthy sense of selfish self-seeking and a proper sense of rational self-concern.
- **Source:** Baseline glossary CON-020
- **Rationale:** A definitional claim isolating two senses of a single term.

#### `nat_025`

- **Claim:** 'Theriotes,' brutishness, names a condition Aristotle treats as categorically outside ordinary vice, paired against superhuman virtue rather than ordinary virtue.
- **Source:** Baseline glossary CON-017
- **Rationale:** A definitional claim about a term's place in the typology, not an interpretive argument about its instability.

#### `nat_026`

- **Claim:** 'Metameleia,' regret, is the term Aristotle uses to mark an agent's retrospective moral pain at a past act.
- **Source:** Baseline glossary CON-010
- **Rationale:** A definitional gloss of the term central to the VII/IX.4 debate's regret criterion.

### Normative (8 records — ✅ clears >=6 floor)

#### `nat_027`

- **Claim:** Akratic wrongdoing is voluntary and therefore blameworthy for Aristotle, even though the agent retains correct judgment he fails to act on.
- **Source:** Aristotle, Nicomachean Ethics III, per PAS-003/PAS-006
- **Rationale:** A claim about moral responsibility and blame, an evaluative/normative matter rather than a bare textual report.

#### `nat_028`

- **Claim:** Giving in to anger is more pardonable, on Aristotle's view, than giving in to appetite for pleasure, because anger listens to reason in a way appetite does not.
- **Source:** Aristotle, Nicomachean Ethics VII, 1149a26-1149b4
- **Rationale:** A claim about degrees of pardon, i.e. a normative ranking rather than a description.

#### `nat_029`

- **Claim:** The fully vicious person, unlike the akratic, is neither curable nor a fit object of pardon, because his ruling practical principle has been corrupted rather than merely overridden.
- **Source:** Aristotle, Nicomachean Ethics VI 1140b20 / VII 1151a6-15
- **Rationale:** A normative claim about who is and is not a fit object of pardon or moral rehabilitation.

#### `nat_030`

- **Claim:** A decent ethical reader cannot, and should not, fully identify with or normalize the fully unregretful Book VII vicious agent.
- **Source:** Roochnik, Aristotle's Account of the Vicious, Part Four
- **Rationale:** A normative claim about the appropriate reader stance, not a descriptive report.

#### `nat_031`

- **Claim:** Aristotle requires that a student of ethics already possess decent habits before the subject can be properly studied, making ethical understanding partly conditional on the student's own character.
- **Source:** Aristotle, Nicomachean Ethics I.4, 1095b4-6
- **Rationale:** A normative claim about who is fit to study ethics.

#### `nat_032`

- **Claim:** Treating the vicious as brutish or subhuman is a moralizing overreach that misdescribes a condition which remains, on Aristotle's own terms, a fully human failure of practical reason.
- **Source:** Nielsen, Vice in the Nicomachean Ethics (per baseline CON-022 framing)
- **Rationale:** A normative claim about how the vicious ought, and ought not, to be characterized.

#### `nat_033`

- **Claim:** Vice, because it is acquired through habituation rather than a single choice, carries a distinctive form of responsibility tied to the agent's own history of habituating himself badly.
- **Source:** Barney, Becoming Bad: Aristotle on Vice and Moral Habituation
- **Rationale:** A claim about the grounds and character of moral responsibility for an acquired state.

#### `nat_034`

- **Claim:** It is more pardonable to be overcome by desires and emotions that are natural and shared by most people than by those that are unnatural or excessive.
- **Source:** Aristotle, Nicomachean Ethics VII, per PAS-025 through PAS-027
- **Rationale:** A normative ranking of the pardonability of different failures.

### Conceptual (8 records — ✅ clears >=6 floor)

#### `nat_035`

- **Claim:** Psychic harmony, reason and desire aligned, can characterize either virtue or vice for Aristotle, since harmony is a formal condition rather than by itself a good one.
- **Source:** Baseline glossary CON-012, per ARG-003
- **Rationale:** A claim about how a concept (harmony) relates structurally to two other concepts (virtue, vice), not a definition of any one term alone.

#### `nat_036`

- **Claim:** Self-friendship is modeled by Aristotle on ordinary interpersonal friendship, extended reflexively to a single agent's relation to himself.
- **Source:** Baseline glossary CON-019, per NE IX.4/IX.8
- **Rationale:** A claim about the conceptual structure linking two ideas -- interpersonal friendship and self-relation.

#### `nat_037`

- **Claim:** Voluntariness and full moral responsibility come apart in Aristotle's framework: an act can be voluntary and blameworthy without being fully and knowingly chosen in the technical sense of prohairesis.
- **Source:** Baseline glossary CON-014
- **Rationale:** A claim about the relationship between two distinct technical concepts, voluntariness and prohairesis.

#### `nat_038`

- **Claim:** 'Saving the phenomena' in ethics, for Roochnik, is not the same as the standard philosophy-of-science sense Kosman warns against, but concerns faithfully rendering how a phenomenon like vice appears to ethical readers.
- **Source:** Roochnik n.2; Kosman, Saving the Phenomena; baseline CON-023
- **Rationale:** A claim distinguishing two senses of the same phrase across two conceptual frameworks.

#### `nat_039`

- **Claim:** Wish (boulesis) is a form of rational desire for an apparent good, distinct from appetite, and its status as practically active or inert is central to later reconciliations of the VII/IX.4 tension.
- **Source:** Baseline glossary CON-037; Solis, Curable and Incurable Vice in Aristotle
- **Rationale:** A claim about how one concept (wish) functions within a broader theoretical structure and debate.

#### `nat_040`

- **Claim:** The ruling practical principle (arche) that vice is said to destroy should not be reduced to a single propositional belief, since Aristotle's practical reason involves more than assertoric belief about means and ends.
- **Source:** Baseline glossary CON-013
- **Rationale:** A claim about the conceptual scope of a technical term relative to a narrower modern notion (propositional belief).

#### `nat_041`

- **Claim:** Brutishness and vice occupy structurally parallel but distinct positions in Aristotle's sixfold moral typology, mirroring how superhuman virtue and ordinary virtue are structurally parallel but distinct.
- **Source:** Aristotle, Nicomachean Ethics VII.1, 1145a16-19
- **Rationale:** A claim about the structural relationships among four concepts within one typology.

#### `nat_042`

- **Claim:** Endoxa, reputable opinions or appearances, function in Aristotelian inquiry as a starting point to be tested and refined, not as an infallible source of truth.
- **Source:** Baseline glossary CON-024; Pritzl, Endoxa as Appearances
- **Rationale:** A claim about the role a concept plays within Aristotelian method, not a definition of the term alone.

### Historical (7 records — ✅ clears >=6 floor)

#### `nat_043`

- **Claim:** Plato's Republic Book IX portrays the tyrannical soul as self-punishing and internally divided, a resource later commentators use as a comparative model for Aristotle's IX.4 vicious person.
- **Source:** Plato, Republic IX, 579b-e
- **Rationale:** A claim about intellectual context and comparative influence between two authors' works.

#### `nat_044`

- **Claim:** Aquinas's Summa Theologiae distinguishes sin from passion, sin from ignorance, and deliberate badness (certa malitia), a threefold distinction Irwin invokes in his opening note.
- **Source:** Aquinas, Summa Theologiae, per Irwin note 1
- **Rationale:** A claim about a medieval philosophical source's later use in a modern scholarly argument, i.e. historical/contextual.

#### `nat_045`

- **Claim:** Plato's Gorgias stages Callicles' immoralist defense of the strong pursuing their own advantage, a dialogue Irwin uses to illustrate what unrestrained intemperance looks like prior to his own analysis.
- **Source:** Plato, Gorgias, per Irwin, Vice and Reason
- **Rationale:** A claim about an earlier dialogue's role as historical/intellectual background for a later argument.

#### `nat_046`

- **Claim:** The scholarly debate over Aristotle's account of vice runs from Annas's 1977 chronological hypothesis through Bostock (2000), Brickhouse (2003), Roochnik (2007), Muller (2015), Nielsen (2017/2023), Barney (2020), to Solis (2025), remaining an active, unsettled question.
- **Source:** Baseline reception finding, sections 9-10
- **Rationale:** A claim about the historical trajectory of a scholarly debate across nearly five decades.

#### `nat_047`

- **Claim:** Homer's Odyssey depicts an afterlife whose bleakness is complicated by the Elysium passage in Book IV, where a peaceful, painless existence is promised to a favored few.
- **Source:** Homer, Odyssey IV.561-569
- **Rationale:** A claim about a related passage's place in the broader Homeric corpus, contextual background for the Book XI analogy.

#### `nat_048`

- **Claim:** Parmenides' fragment 4 concerns whether what is absent can nonetheless be brought before thought as present, an idea Roochnik uses as a brief analogy for remembering the dead.
- **Source:** Parmenides, fragment 4, per Roochnik n.20
- **Rationale:** A claim about a much earlier Presocratic source's use as historical/philosophical background for a later argument.

#### `nat_049`

- **Claim:** Roochnik's paper has been received unevenly in later scholarship: Carter reconstructs and engages it while preferring an Irwin-style account, Solis classifies it among inconsistency readings and proposes an alternative, and Muller and Nielsen develop independent accounts that implicitly bypass it.
- **Source:** Baseline reception finding, section 6
- **Rationale:** A claim about the historical reception and citation pattern of one paper within its field.

### Empirical (8 records — ✅ clears >=6 floor)

#### `nat_050`

- **Claim:** ACE's structured, turn-by-turn feedback produced a statistically significant improvement in negotiation performance between trials, while unstructured zero-shot GPT-4 feedback did not.
- **Source:** ACE: A LLM-based Negotiation Coaching System, findings
- **Rationale:** A quantitative, hypothesis-tested finding (t=2.97, p=0.003) reported from a human-subjects experiment.

#### `nat_051`

- **Claim:** Participants trained with Rehearsal's simulated conflict practice substantially reduced competitive strategy use and increased cooperative strategy use in a subsequent real, unaided conflict.
- **Source:** Rehearsal: Simulating Conflict to Teach Conflict Resolution, findings
- **Rationale:** A behavioral outcome measured in a real (not simulated) follow-up interaction, an empirical transfer result.

#### `nat_052`

- **Claim:** Making a high initial offer in a negotiation correlates positively and significantly with eventual earnings.
- **Source:** Towards An Autonomous Agent that Provides Automated Feedback on Students' Negotiation Skills, findings
- **Rationale:** A reported correlation coefficient (r=0.47, p<0.001) from empirical negotiation data.

#### `nat_053`

- **Claim:** A theory-driven AI negotiation coach produced a larger reduction in negotiation-related fear than either a generic AI chatbot or a static handbook.
- **Source:** Does AI Coaching Prepare us for Workplace Negotiations?, findings
- **Rationale:** A between-condition comparison with reported effect sizes, an empirical experimental result.

#### `nat_054`

- **Claim:** Combining a lexical BM25 retrieval pass with dense retrieval substantially raised Recall@100 relative to dense retrieval alone on the benchmark tested.
- **Source:** Hybrid Sparse-Dense Retrieval for Open-Domain QA, findings
- **Rationale:** A benchmark metric result (Recall@100 0.71 to 0.88), an empirical IR finding.

#### `nat_055`

- **Claim:** Retrieval accuracy plateaued beyond a moderate embedding dimensionality and degraded at very high dimensions in the reported experiments.
- **Source:** Diminishing Returns in High-Dimensional Embeddings, findings
- **Rationale:** An empirical scaling result across tested embedding sizes.

#### `nat_056`

- **Claim:** Larger language models were found to hallucinate more confidently in the reported experiments, producing fluent but false statements that were harder for users to detect.
- **Source:** Confident Hallucination at Scale, findings
- **Rationale:** An empirical finding about model scale and hallucination confidence from reported experiments.

#### `nat_057`

- **Claim:** Retrieval-augmented generation reduced factual hallucination on knowledge-intensive queries by grounding model answers in retrieved passages.
- **Source:** Retrieval-Augmented Generation for Knowledge Tasks, findings
- **Rationale:** An empirical result comparing RAG to a non-retrieval baseline on hallucination rate.

### Methodological (8 records — ✅ clears >=6 floor)

#### `nat_058`

- **Claim:** The negotiation dataset underlying ACE's evaluation was collected from 50 MBA students conducting simulated used-car negotiations, transcribed via OpenAI's Whisper API with manual correction.
- **Source:** ACE: A LLM-based Negotiation Coaching System, methods
- **Rationale:** A description of data-collection procedure, a methodological rather than a findings claim.

#### `nat_059`

- **Claim:** The Trucey study recruited 267 participants through Prolific and randomly assigned them across three conditions in a 2:1:1 ratio.
- **Source:** Does AI Coaching Prepare us for Workplace Negotiations?, methods
- **Rationale:** A description of sampling and randomization procedure.

#### `nat_060`

- **Claim:** The Rehearsal user study used a between-subjects design in which 40 participants engaged in an actual conflict with a confederate after training.
- **Source:** Rehearsal: Simulating Conflict to Teach Conflict Resolution, methods
- **Rationale:** A description of experimental design, a methodological claim distinct from the study's findings.

#### `nat_061`

- **Claim:** The retrieval corpus was deduplicated using MinHash locality-sensitive hashing at a Jaccard similarity threshold of 0.8 before indexing.
- **Source:** Scaling Embedding Dimensions for Retrieval, methods
- **Rationale:** A description of a preprocessing pipeline step, purely methodological.

#### `nat_062`

- **Claim:** The language model evaluated for chain-of-thought prompting was instruction-tuned on 1.5 million examples drawn from a mixture of twelve task families.
- **Source:** Chain-of-Thought Prompting Elicits Reasoning, methods
- **Rationale:** A description of model training data composition, methodological in nature.

#### `nat_063`

- **Claim:** Evaluation of self-consistency sampling used 5-shot prompting at temperature 0 with a single fixed prompt template applied across all tasks.
- **Source:** Self-Consistency Improves Chain-of-Thought, methods
- **Rationale:** A description of the evaluation protocol's fixed parameters.

#### `nat_064`

- **Claim:** The Rehearsal pipeline classifies and scores conflict-resolution utterances using an 8-strategy taxonomy drawn from the Interests-Rights-Power framework.
- **Source:** Rehearsal: Simulating Conflict to Teach Conflict Resolution, methods
- **Rationale:** A description of an annotation/scoring scheme, a methodological design choice.

#### `nat_065`

- **Claim:** The Trucey study's willingness-to-initiate result depended on the analytical choice made: an adjusted regression found a significant effect, while an unadjusted Kruskal-Wallis group comparison found no significant difference.
- **Source:** Does AI Coaching Prepare us for Workplace Negotiations?, methodological note
- **Rationale:** A claim about how the choice of statistical method itself changed the reported result, a methodological claim about analysis technique.
## 4. Retrieval negatives — `retrievalNegatives.json` (22 records)

All 22 records are labeled `unrelated`, category `scope`, deliberately pairing an `ancient_philosophy` claim against a claim from one of three unrelated ScholarLens domains (`negotiation_coaching`, `information_retrieval`, `llm_reasoning`). These exist to give the stage-1 retrieval/separation harness honest should-reject mass, not to test relationship-label nuance — **these mostly need a sanity skim**: confirm each pair really is topically unrelated (it should be, by construction) and that neither claim text has drifted from its cited source.

| ID | Domains | Claim A (source) | Claim B (source) | Rationale |
|---|---|---|---|---|
| `negx_001` | ancient_philosophy vs negotiation_coaching | "Akrasia denotes a failure to act on one's own better judgment under the pull of appetite or emotion, distinct from vice." — *Aristotle, Nicomachean Ethics VII (baseline glossary)* | "ACE's structured, turn-by-turn feedback produced a statistically significant improvement in negotiation performance between trials, while unstructured zero-shot feedback did not." — *ACE: A LLM-based Negotiation Coaching System* | A classical moral-psychology definition and an empirical negotiation-training finding share no topical or logical overlap. |
| `negx_002` | ancient_philosophy vs information_retrieval | "Aristotle's sixfold moral typology places superhuman virtue, virtue, continence, incontinence, vice, and brutishness as distinct character categories." — *Aristotle, Nicomachean Ethics VII.1* | "Combining a lexical BM25 retrieval pass with dense retrieval substantially raised Recall@100 relative to dense retrieval alone." — *Hybrid Sparse-Dense Retrieval for Open-Domain QA* | An ancient moral typology and a modern information-retrieval benchmark result have nothing in common beyond both being scholarly claims. |
| `negx_003` | ancient_philosophy vs llm_reasoning | "Aristotle's two incompatible portraits of the vicious person are best explained, not resolved, because together they capture how radical vice appears to an ethical reader." — *Roochnik, Aristotle's Account of the Vicious* | "Larger language models were found to hallucinate more confidently in the reported experiments, producing fluent but false statements harder for users to detect." — *Confident Hallucination at Scale* | A thesis about Aristotelian textual inconsistency and an empirical LLM-scale hallucination finding share no relationship. |
| `negx_004` | ancient_philosophy vs negotiation_coaching | "The virtuous person is a friend to himself because his rational and non-rational parts agree and he wishes himself well." — *Aristotle, Nicomachean Ethics IX.4* | "Participants trained with Rehearsal's simulated conflict practice substantially reduced competitive strategy use and increased cooperative strategy use in a subsequent real, unaided conflict." — *Rehearsal: Simulating Conflict to Teach Conflict Resolution* | A claim about Aristotelian self-friendship and an empirical conflict-training transfer result are unrelated. |
| `negx_005` | ancient_philosophy vs information_retrieval | "Homer's Odyssey XI presents shades of the dead as nearly insubstantial yet capable of fear and of suffering deserved punishment." — *Homer, Odyssey XI* | "Retrieval accuracy plateaued beyond a moderate embedding dimensionality and degraded at very high dimensions in the reported experiments." — *Diminishing Returns in High-Dimensional Embeddings* | A Homeric interpretive claim and an embedding-dimensionality scaling result share no logical relationship. |
| `negx_006` | ancient_philosophy vs negotiation_coaching | "Virtuous agents choose for the sake of the fine (kalon), while vicious agents orient toward the merely expedient (sumpheron)." — *Irwin, Vice and Reason* | "A theory-driven AI negotiation coach produced a larger reduction in negotiation-related fear than either a generic AI chatbot or a static handbook." — *Does AI Coaching Prepare us for Workplace Negotiations?* | A definitional distinction in Aristotelian ethics and an empirical psychological-outcome comparison bear no relationship. |
| `negx_007` | ancient_philosophy vs llm_reasoning | "A vicious person can be internally harmonious at one time and later conflicted once growing appetite defeats a plan for maximal pleasure." — *Brickhouse, Does Aristotle Have a Consistent Account of Vice?* | "Majority voting over independently sampled reasoning paths raised accuracy on arithmetic and commonsense benchmarks." — *Sampling-and-Voting for Reasoning* | A developmental reconciliation of Aristotle's account of vice and a self-consistency decoding result are unrelated. |
| `negx_008` | ancient_philosophy vs information_retrieval | "Syngnome ranges in sense across acknowledgment, fellow-feeling, allowance, excuse, and pardon, with no single fixed modern equivalent." — *Liddell, Scott, Jones and McKenzie, A Greek-English Lexicon (9th ed.), s.v. syngnome* | "Cross-encoder reranking of top candidates substantially improved Precision@10 over the first-stage retriever but added several hundred milliseconds of query latency." — *Reranking for Precision in Two-Stage Retrieval / The Latency Cost of Neural Reranking* | A Greek lexical-range fact and a two-stage retrieval latency/precision tradeoff have no logical relationship. |
| `negx_009` | ancient_philosophy vs negotiation_coaching | "Plato's Republic Book IX portrays the tyrannical soul as self-punishing and internally divided." — *Plato, Republic IX* | "The Trucey study recruited 267 participants through Prolific and randomly assigned them across three conditions in a 2:1:1 ratio." — *Does AI Coaching Prepare us for Workplace Negotiations?* | A Platonic comparative claim and a study's recruitment/randomization method are unrelated. |
| `negx_010` | ancient_philosophy vs llm_reasoning | "Vice is best understood as a settled commitment to a corrupted conception of the good, arrived at through mistaken practical reasoning." — *Nielsen, Vice in the Nicomachean Ethics* | "Retrieval-augmented generation reduced factual hallucination on knowledge-intensive queries by grounding model answers in retrieved passages." — *Retrieval-Augmented Generation for Knowledge Tasks* | A thesis about Aristotelian vice and an empirical RAG hallucination-reduction finding share no relationship. |
| `negx_011` | ancient_philosophy vs negotiation_coaching | "Ethical inquiry should seek only the precision its subject matter allows, not the exactness proper to mathematics." — *Aristotle, Nicomachean Ethics I.3* | "Making a high initial offer in a negotiation was found to correlate positively and significantly with eventual earnings." — *Towards An Autonomous Agent that Provides Automated Feedback on Students' Negotiation Skills* | A methodological principle about ethical inquiry's precision and an empirical negotiation-tactics correlation are unrelated. |
| `negx_012` | ancient_philosophy vs information_retrieval | "The vicious person lacks a stable, unified rational conception of the good; his apparent commitments merely track whatever pleasure is present." — *Muller, Aristotle on Vice* | "The retrieval corpus was deduplicated using MinHash locality-sensitive hashing at a Jaccard similarity threshold of 0.8 before indexing." — *Scaling Embedding Dimensions for Retrieval* | A characterization of Aristotelian vice and a corpus-preprocessing method detail have no logical relationship. |
| `negx_013` | ancient_philosophy vs negotiation_coaching | "An incurable form of vice matches Book VII's unregretful portrait, and a curable form matches Book IX.4's regretful portrait -- two distinct varieties rather than one inconsistently described type." — *Solis, Curable and Incurable Vice in Aristotle* | "ACE used GPT-4 for its negotiation chat agent and GPT-4o for feedback generation, chosen for speed after expert evaluation." — *ACE: A LLM-based Negotiation Coaching System* | A curable/incurable-vice reconciliation thesis and a model-selection engineering detail are unrelated. |
| `negx_014` | ancient_philosophy vs llm_reasoning | "Parmenides' fragment 4 concerns whether what is absent can nonetheless be brought before thought as present." — *Parmenides, fragment 4* | "The model evaluated for chain-of-thought prompting was instruction-tuned on 1.5 million examples drawn from a mixture of twelve task families." — *Chain-of-Thought Prompting Elicits Reasoning* | A Presocratic fragment's content and a training-data composition detail have no logical relationship. |
| `negx_015` | ancient_philosophy vs negotiation_coaching | "Vice arises through habituation, a reason-corrupting process of becoming bad distinct from a single akratic lapse." — *Barney, Becoming Bad: Aristotle on Vice and Moral Habituation* | "Frontline humanitarian negotiators found process-oriented AI tools that surfaced options and risks more effective than tools providing direct strategy recommendations." — *ChatGPT, Don't Tell Me What to Do: Designing AI for Context Analysis in Humanitarian Frontline Negotiations* | A habituation account of Aristotelian vice and a qualitative finding about negotiator tool preferences are unrelated. |
| `negx_016` | ancient_philosophy vs negotiation_coaching | "At NE VII 1148a17-18, Aristotle describes the intemperate person as pursuing excessive pleasures without desire, or with only weak desire, for them." — *Aristotle, Nicomachean Ethics VII* | "Trucey's responses were substantially less verbose than a generic chatbot's and scored significantly higher on standard readability measures." — *Does AI Coaching Prepare us for Workplace Negotiations?* | A textual claim about intemperate desire and an empirical readability comparison are unrelated. |
| `negx_017` | ancient_philosophy vs information_retrieval | "Book IX.4's conflicted, regretful portrait of vice may reflect an earlier stage of composition, locally influenced by the Platonic Lysis." — *Annas, Plato and Aristotle on Friendship and Altruism* | "Query expansion with generated paraphrases improved recall for short, underspecified queries by several points." — *Generative Query Expansion for Sparse Queries* | A chronological-composition hypothesis about Aristotle's text and a query-expansion recall result share no relationship. |
| `negx_018` | ancient_philosophy vs negotiation_coaching | "Aquinas distinguishes sin from passion, sin from ignorance, and deliberate badness (certa malitia) as three separate categories." — *Aquinas, Summa Theologiae (per Irwin, note 1)* | "Theory-grounded prompting significantly outperformed standard instruction-following prompting for generating realistic conflict simulations." — *Rehearsal: Simulating Conflict to Teach Conflict Resolution* | A medieval scholastic distinction about sin and an empirical prompting-method comparison are unrelated. |
| `negx_019` | ancient_philosophy vs llm_reasoning | "Philautia, self-love, is equivocal in Aristotle between a blameworthy selfish sense and a proper sense of rational self-concern." — *Aristotle, Nicomachean Ethics IX.8 (baseline glossary)* | "Chain-of-thought prompting provided negligible benefit on single-step tasks and occasionally hurt accuracy by introducing spurious intermediate steps." — *When Chain-of-Thought Does Not Help* | A definitional claim about Aristotelian self-love and a chain-of-thought scope finding have no logical relationship. |
| `negx_020` | ancient_philosophy vs negotiation_coaching | "Roochnik credits an extended conversation with Anna Lannstrom for originating the idea behind his paper." — *Roochnik, Aristotle's Account of the Vicious (acknowledgements)* | "ACE's interactive LLM coaching significantly outperformed both no-feedback and alternative-feedback conditions on objective negotiation outcomes." — *ACE: A LLM-based Negotiation Coaching System* | A paper's acknowledgements detail and an empirical coaching-outcome finding are unrelated. |
| `negx_021` | ancient_philosophy vs negotiation_coaching | "The Perseus Digital Library provides an aligned Greek/English reading interface used to check Bekker-referenced passages." — *Perseus Digital Library, Nicomachean Ethics text tool* | "Cultural background significantly moderated AI coaching effectiveness in negotiation, with outcomes varying across participant backgrounds." — *Does AI Coaching Prepare us for Workplace Negotiations?* | A digital-tooling detail for checking a classical text and an empirical cultural-moderation finding share no relationship. |
| `negx_022` | ancient_philosophy vs information_retrieval | "Bywater's 1962 Oxford reprint of the Greek Ethica Nicomachea is the critical-edition text Roochnik cites as his source." — *Bywater (ed.), Ethica Nicomachea* | "In-domain fine-tuned bi-encoders matched cross-encoder relevance while retrieving an order of magnitude faster." — *Closing the Bi-Encoder Gap with In-Domain Training* | A critical-edition citation detail and a bi-encoder-versus-cross-encoder retrieval result are unrelated. |
## 5. Ratification checklist and count summary

### How to ratify

1. **Read each card above** against its cited source (the `baseline-test/roochnik_vicious_baseline_test.md` argument map, the `docs/eval/irwin-vice-and-reason/vice-and-reason.manifest.json` fixture, or the Nicomachean Ethics/secondary-source passage named directly).
2. **Decide per record**, three outcomes:
   - **Keep as-is** → in the JSON file, flip that record's `"provisional": true` to `"provisional": false`. No other edit needed.
   - **Keep with a correction** → edit the wrong field first (`label`, `category`, `mechanismDraft`, or the `rationale` itself if it misstates the source), *then* flip `provisional` to `false`.
   - **Reject** → delete the record from the JSON array entirely. IDs are independent (`hum_NNN`/`negx_NNN`/`nat_NNN`); no renumbering is required, though you may renumber for cleanliness once the set is final.
3. **Two equally valid ways to do the editing itself:**
   - Edit the three JSON files directly (`relationshipPairs.humanities.json`, `retrievalNegatives.json`, `claimNature.json`) by hand, or
   - Annotate a copy of this packet with a per-id verdict (`hum_009: keep`, `hum_017: mechanismDraft → different_definition`, `negx_014: delete`, etc.) and hand it back to an agent to apply mechanically — faster for a large batch of simple accept/reject calls.
4. **The 11 ⚠️-flagged relationship pairs (Section 2) deserve the closest look first** — each pairs two claims from the *same* underlying work (e.g. `hum_016`: both claims cite NE VII; `hum_029`: both claims cite Roochnik). Several of these look like deliberate internal-tension probes (the VII/IX.4 textual pairs are the whole point of this domain's debate), but each should be confirmed as intentional rather than a mismatched cross-work pair drafted in error.
5. **The retrieval negatives (Section 4) are lower-stakes** — they're deliberately cross-domain "obviously unrelated" pairs for stage-1 retrieval separation, not nuanced relationship judgments. A sanity skim confirming no topical overlap slipped in and no claim text drifted from its cited source is sufficient.
6. **Nothing in `claimNature.json`'s 8 groups is below the `MIN_GOLD_PER_VALUE = 6` floor** — every group already clears it (smallest is `historical` at 7), so no group needs backfilling before the gate can trust its own per-class number, only review for correctness.
7. Once every surviving record across all three files carries `"provisional": false`, the 27.3 lane (Opus-assigned, per `docs/project-status.json`) can run the branch eval against the four promotion floors in Section 1 and, on a pass, apply migration `0046` and flip the humanities-branch flag.

### Count summary

| File | Total records | Groups | Flagged for closest look |
|---|---|---|---|
| `relationshipPairs.humanities.json` | 36 | contradiction 7 · nuance 15 (11 carry `mechanismDraft`) · support 8 · unrelated 6 | 11 (all same-work pairs; 0 hedging-language hits) |
| `retrievalNegatives.json` | 22 | all `unrelated` / `scope` (cross-domain by construction) | 0 (sanity-skim only, per RATIFICATION.md) |
| `claimNature.json` | 65 | textual 9 · interpretive 9 · definitional 8 · normative 8 · conceptual 8 · historical 7 · empirical 8 · methodological 8 | 0 (single-claim records; no cross-source or hedging check applies) |
| **Total** | **123** | | **11** |

Estimated review time (per `RATIFICATION.md`): 1–2 hours for a domain-fluent reviewer working through all 123 records.
