import { toolRegistry } from './tool-registry.js';
import { documentSearchTool } from './definitions/document-search.tool.js';
import { memorySearchTool } from './definitions/memory-search.tool.js';
import { saveMemoryTool } from './definitions/save-memory.tool.js';
import { summarizeTool } from './definitions/summarize.tool.js';
import { generateReportTool } from './definitions/generate-report.tool.js';

// ─── Tool registration ────────────────────────────────────────────────────────
//
// Called once from server.ts and worker.ts before accepting requests/jobs.

export function registerTools(): void {
  toolRegistry.register(documentSearchTool);
  toolRegistry.register(memorySearchTool);
  toolRegistry.register(saveMemoryTool);
  toolRegistry.register(summarizeTool);
  toolRegistry.register(generateReportTool);
}
