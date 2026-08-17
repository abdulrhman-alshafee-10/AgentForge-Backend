export class ChunkingService {
  constructor(private chunkSize: number = 1000, private chunkOverlap: number = 200) {}

  /**
   * Splits text into smaller chunks using a simple recursive character strategy.
   * Prioritizes splitting on double newlines, then single newlines, then spaces.
   */
  chunkText(text: string): string[] {
    const separators = ['\n\n', '\n', ' ', ''];
    return this.splitText(text, separators);
  }

  private splitText(text: string, separators: string[]): string[] {
    if (text.length <= this.chunkSize) {
      return [text];
    }

    const separator = separators.find((s) => text.includes(s)) ?? '';
    const splits = text.split(separator);
    
    let chunks: string[] = [];
    let currentChunk = '';

    for (const split of splits) {
      if (currentChunk.length + separator.length + split.length <= this.chunkSize) {
        currentChunk += (currentChunk ? separator : '') + split;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        // If a single split is larger than chunkSize, we need to recurse with a smaller separator
        if (split.length > this.chunkSize && separators.length > 1) {
          const subSeparators = separators.slice(separators.indexOf(separator) + 1);
          const subChunks = this.splitText(split, subSeparators);
          chunks.push(...subChunks);
          currentChunk = ''; // Reset since we handled the oversized split
        } else {
          currentChunk = split;
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    // Apply overlap by merging
    return this.applyOverlap(chunks);
  }

  private applyOverlap(chunks: string[]): string[] {
    if (chunks.length <= 1) return chunks;

    const first = chunks[0];
    if (first === undefined) return chunks;

    const overlapped: string[] = [first];
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1] ?? '';
      const curr = chunks[i] ?? '';
      const overlapText = prev.slice(-this.chunkOverlap);
      overlapped.push(overlapText + curr);
    }
    return overlapped;
  }
}

export const chunkingService = new ChunkingService();
