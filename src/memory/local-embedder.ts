/**
 * HIVEMIND Local Embedding Provider (#5)
 *
 * Zero-config local embedding using @xenova/transformers.
 * Runs a lightweight ONNX model in-process — no external API needed.
 * Falls back gracefully if the package isn't installed.
 */

import type { EmbeddingProvider } from "./store.js";

/** Default model — small, fast, good quality for retrieval. */
const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMENSION = 384;

/**
 * Create a local embedding provider using @xenova/transformers.
 *
 * Usage:
 *   const embedder = await createLocalEmbedder();
 *   const store = new MemoryStore({ dbPath: "./data/hivemind.db" });
 *   await store.initialize(embedder);
 */
export async function createLocalEmbedder(
  modelName = DEFAULT_MODEL,
): Promise<EmbeddingProvider> {
  let pipeline: any;

  try {
    // Dynamic import — only loads if the package is installed
    // @ts-expect-error — optional dependency, only loaded if installed
    const transformers = await import("@xenova/transformers");
    pipeline = await transformers.pipeline("feature-extraction", modelName, {
      quantized: true, // Use quantized model for speed
    });
  } catch (err) {
    throw new Error(
      `Failed to load local embedding model "${modelName}". ` +
        `Install @xenova/transformers: npm install @xenova/transformers\n` +
        `Original error: ${(err as Error).message}`,
    );
  }

  const dimension = modelName === DEFAULT_MODEL ? DEFAULT_DIMENSION : 384;

  return {
    dimension,
    async embed(text: string): Promise<Float32Array> {
      const output = await pipeline(text, {
        pooling: "mean",
        normalize: true,
      });
      // output.data is a Float32Array of the embedding
      return new Float32Array(output.data);
    },
  };
}

/**
 * Try to create a local embedder. Returns null if @xenova/transformers
 * is not installed (instead of throwing). Useful for optional setup.
 */
export async function tryCreateLocalEmbedder(
  modelName = DEFAULT_MODEL,
): Promise<EmbeddingProvider | null> {
  try {
    return await createLocalEmbedder(modelName);
  } catch {
    return null;
  }
}

export { DEFAULT_MODEL, DEFAULT_DIMENSION };
