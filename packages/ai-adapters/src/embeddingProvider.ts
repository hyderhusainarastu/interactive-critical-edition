import { OpenAIEmbeddingsClient, estimateEmbeddingCostUsd } from "./embeddings";

/**
 * Provider seam over `OpenAIEmbeddingsClient` (Phase 25, ScholarLens
 * integration). The classify/responses packages already keep an
 * interface-only boundary between business logic and any one vendor
 * (types.ts's `LLMProvider`); this is the same shape for embeddings, so
 * a future second embeddings vendor is a new class here, never a change
 * to any caller.
 */
export interface EmbeddingBatchResult {
  /** Same order as the input `texts` array. */
  vectors: number[][];
  model: string;
  inputTokens: number;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dim: number;
  readonly available: boolean;
  embedBatch(texts: string[]): Promise<EmbeddingBatchResult>;
  estimateCostUsd(inputTokens: number): number;
}

/** The subset of env vars this seam reads. A plain optional-string shape
 *  (rather than `Pick<NodeJS.ProcessEnv, ...>`) so both `process.env` and a
 *  plain test object satisfy it — `NodeJS.ProcessEnv`'s index signature
 *  makes `Pick` require the key to be a literal own property, which a
 *  fresh object literal (as every test here passes) doesn't have. */
export interface EmbeddingEnv {
  OPENAI_API_KEY?: string;
  EMBEDDING_PROVIDER?: string;
  RESEARCH_EMBEDDING_MODEL?: string;
  VOYAGE_API_KEY?: string;
  VOYAGE_EMBEDDING_MODEL?: string;
  // An explicit index signature (matching NodeJS.ProcessEnv's own shape)
  // keeps this an ordinary indexable type rather than a TS "weak type"
  // (all-optional, no index signature) — the latter fails a structural
  // assignability check against `process.env` under some @types/node
  // resolutions (observed: passes in this package's own typecheck, fails
  // from apps/web's, both against the same source file).
  [key: string]: string | undefined;
}

const OPENAI_EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

export class OpenAIEmbeddingsProvider implements EmbeddingProvider {
  readonly id = "openai";
  readonly model: string;
  readonly dim: number;
  private readonly client: OpenAIEmbeddingsClient;

  constructor(apiKey: string | undefined = process.env.OPENAI_API_KEY, model?: string) {
    this.model = model ?? "text-embedding-3-small";
    this.dim = OPENAI_EMBEDDING_DIMENSIONS[this.model] ?? OPENAI_EMBEDDING_DIMENSIONS["text-embedding-3-small"];
    this.client = new OpenAIEmbeddingsClient(apiKey);
  }

  get available(): boolean {
    return this.client.available;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingBatchResult> {
    return this.client.embedMany(texts, this.model);
  }

  estimateCostUsd(inputTokens: number): number {
    return estimateEmbeddingCostUsd(this.model, inputTokens);
  }
}

/**
 * Stub only — no live Voyage integration exists. Deliberately
 * double-gated on BOTH `VOYAGE_API_KEY` AND an explicit
 * `EMBEDDING_PROVIDER=voyage` selection, so a stray key left in an env
 * file (e.g. copied from a `.env.example` template) can never silently
 * activate a second paid vendor account — provisioning one is a new
 * account/payment-setting change requiring explicit owner approval
 * (docs/PROJECT-LOG.md's standing prohibition). Accidental activation is
 * impossible; deliberate activation still hits the stub below rather
 * than making a real call.
 */
export class VoyageEmbeddingsProvider implements EmbeddingProvider {
  readonly id = "voyage";
  readonly model: string;
  readonly dim = 1024; // voyage-3's published dimension; unused until real integration exists

  constructor(private readonly env: EmbeddingEnv = process.env) {
    this.model = env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3";
  }

  get available(): boolean {
    return Boolean(this.env.VOYAGE_API_KEY) && this.env.EMBEDDING_PROVIDER === "voyage";
  }

  async embedBatch(_texts: string[]): Promise<EmbeddingBatchResult> {
    if (!this.available) {
      throw new Error(
        "Voyage embeddings require both VOYAGE_API_KEY and EMBEDDING_PROVIDER=voyage to be set explicitly",
      );
    }
    throw new Error("Voyage embeddings provider is a stub — no live integration is implemented yet");
  }

  estimateCostUsd(_inputTokens: number): number {
    return 0;
  }
}

/** Honest "no provider configured" stub — mirrors the classifier's
 *  heuristic-fallback honesty (providers/heuristic.ts): callers must
 *  check `available` before calling `embedBatch`, which always throws a
 *  clear, actionable message rather than silently returning zero
 *  vectors. */
export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly id = "none";
  readonly model = "none";
  readonly dim = 0;
  readonly available = false;

  async embedBatch(_texts: string[]): Promise<EmbeddingBatchResult> {
    throw new Error("No embedding provider is configured (OPENAI_API_KEY is not set) — embeddings are unavailable");
  }

  estimateCostUsd(_inputTokens: number): number {
    return 0;
  }
}

/**
 * Selects the embedding provider from env, matching `getProviderForTask`'s
 * "which provider is available lives here, never in business logic"
 * principle (index.ts). `EMBEDDING_PROVIDER=voyage` opts into the Voyage
 * stub explicitly (still gated on `VOYAGE_API_KEY` inside the class
 * itself); anything else uses OpenAI when a key is present, honoring
 * `RESEARCH_EMBEDDING_MODEL` for a model override (e.g.
 * `text-embedding-3-large`), else falls back to the honest Null provider.
 */
export function resolveEmbeddingProvider(env: EmbeddingEnv = process.env): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === "voyage") {
    return new VoyageEmbeddingsProvider(env);
  }
  if (!env.OPENAI_API_KEY) return new NullEmbeddingProvider();
  return new OpenAIEmbeddingsProvider(env.OPENAI_API_KEY, env.RESEARCH_EMBEDDING_MODEL);
}
