import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/AppError.js';

export class EmbeddingsProvider {
  private client: OpenAI;

  constructor() {
    // The OpenAI SDK is reused as a Ollama-compatible client.
    // Local Ollama serves an OpenAI-compatible API at /v1 by default.
    this.client = new OpenAI({
      baseURL: env.OLLAMA_BASE_URL,
      apiKey: env.OLLAMA_API_KEY,
    });
  }

  /**
   * Generates embeddings for a batch of text chunks.
   * Ollama's nomic-embed-text model outputs 768-dimensional vectors.
   */
  async embedBatch(chunks: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: env.OLLAMA_EMBED_MODEL,
        input: chunks,
      });

      return response.data.map((d) => d.embedding);
    } catch (err: any) {
      // AppError(message, statusCode, code)
      throw new AppError(`Embedding failed: ${err.message}`, 503, 'DEPENDENCY_UNAVAILABLE');
    }
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
