import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/AppError.js';

export class EmbeddingsProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://ollama.com/api',
      apiKey: env.OLLAMA_API_KEY,
    });
  }

  /**
   * Generates embeddings for a batch of text chunks.
   */
  async embedBatch(chunks: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: 'nomic-embed-text', // Outputs 768 dimensions by default
        input: chunks,
      });

      return response.data.map((d) => d.embedding);
    } catch (err: any) {
      throw new AppError('DEPENDENCY_UNAVAILABLE', `Embedding failed: ${err.message}`, 503);
    }
  }

  /**
   * Generates an embedding for a single text chunk.
   */
  async embedQuery(query: string): Promise<number[]> {
    const embeddings = await this.embedBatch([query]);
    return embeddings[0] as number[];
  }
}

export const embeddingsProvider = new EmbeddingsProvider();
