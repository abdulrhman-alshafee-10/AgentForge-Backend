import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/AppError.js';
import { getCachedEmbedding, setCachedEmbedding } from '../../common/cache/cache.js';

export class EmbeddingsProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: env.OLLAMA_BASE_URL,
      apiKey: env.OLLAMA_API_KEY,
    });
  }

  /**
   * Generates embeddings for a batch of text chunks.
   * Each chunk is checked against the Redis cache first; only uncached
   * chunks are sent to Ollama.
   */
  async embedBatch(chunks: string[]): Promise<number[][]> {
    const results: (number[] | null)[] = await Promise.all(
      chunks.map((c) => getCachedEmbedding(env.OLLAMA_EMBED_MODEL, c)),
    );

    // Find which chunks are not cached
    const uncachedIndices: number[] = [];
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) uncachedIndices.push(i);
    }

    if (uncachedIndices.length > 0) {
      const uncachedChunks = uncachedIndices.map((i) => chunks[i]!);
      try {
        const response = await this.client.embeddings.create({
          model: env.OLLAMA_EMBED_MODEL,
          input: uncachedChunks,
        });

        for (let j = 0; j < uncachedIndices.length; j++) {
          const idx = uncachedIndices[j]!;
          const vector = response.data[j]!.embedding;
          results[idx] = vector;
          // Cache for future calls
          await setCachedEmbedding(env.OLLAMA_EMBED_MODEL, chunks[idx]!, vector);
        }
      } catch (err: any) {
        throw new AppError(`Embedding failed: ${err.message}`, 503, 'DEPENDENCY_UNAVAILABLE');
      }
    }

    return results as number[][];
  }

  /**
   * Generates an embedding for a single query string.
   */
  async embedQuery(query: string): Promise<number[]> {
    const embeddings = await this.embedBatch([query]);
    const first = embeddings[0];
    if (!first) throw new AppError('Embedding returned empty result', 503, 'DEPENDENCY_UNAVAILABLE');
    return first;
  }
}

export const embeddingsProvider = new EmbeddingsProvider();
