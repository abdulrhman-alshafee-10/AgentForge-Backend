import * as pdfParseModule from 'pdf-parse';
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
import { AppError } from '../../common/errors/AppError.js';

export class ExtractionService {
  /**
   * Extracts raw text from a file buffer based on its mime type.
   */
  async extractText(buffer: Buffer, mimeType: string): Promise<string> {
    switch (mimeType) {
      case 'application/pdf':
        return this.extractPdf(buffer);
      case 'text/plain':
      case 'text/markdown':
      case 'text/csv':
        return buffer.toString('utf-8');
      default:
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', `Unsupported file type: ${mimeType}`, 415);
    }
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(buffer);
      return data.text;
    } catch (err) {
      throw new AppError('SEMANTIC_ERROR', 'Failed to extract text from PDF', 422);
    }
  }
}

export const extractionService = new ExtractionService();
