import { toolRegistry } from './tool-registry.js';
import { documentSearchTool } from './definitions/document-search.tool.js';
import { memorySearchTool } from './definitions/memory-search.tool.js';
import { summarizeTool } from './definitions/summarize.tool.js';
import { generateReportTool } from './definitions/generate-report.tool.js';

// ─── Tool registration ────────────────────────────────────────────────────────
//
// Called once from server.ts before the HTTP server starts listening.
// All tools are registered here so the registry is fully populated before
// the first request arrives.
//
// Registration order determines the order tools appear in the manifest.

export function registerTools(): void {
  toolRegistry.register(documentSearchTool);
  toolRegistry.register(memorySearchTool);
  toolRegistry.register(summarizeTool);
  toolRegistry.register(generateReportTool);
}
