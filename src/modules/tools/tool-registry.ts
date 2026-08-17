import type { ToolDefinition, ToolManifest } from './tool.types.js';
import { AppError } from '../../common/errors/AppError.js';
import { logger } from '../../common/logger/logger.js';

// ─── Tool Registry ────────────────────────────────────────────────────────────
//
// A simple in-memory registry.  Tools are registered once at startup.
// Registration validates the Zod schema eagerly so broken tools are caught
// before the first request arrives.

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool.  Throws at startup if the name is already taken or the
   * schema is not a valid Zod object schema.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    // Validate the schema is parseable by calling safeParse with an empty
    // object — the goal is to confirm the schema itself is well-formed, not
    // that the empty object is valid input.
    const probe = tool.inputSchema.safeParse({});
    if (probe.error) {
      const firstCode = probe.error.issues[0]?.code;
      // If all issues are "invalid_type" / "too_small" the schema is fine
      // (those mean fields are required, not that the schema is broken).
      const structuralCodes = new Set(['invalid_type', 'too_small', 'too_big', 'invalid_union']);
      const hasBrokenCode = probe.error.issues.some((i) => !structuralCodes.has(i.code));
      if (hasBrokenCode) {
        throw new Error(`Tool "${tool.name}" has an invalid inputSchema: ${probe.error.message}`);
      }
    }

    this.tools.set(tool.name, tool);
    logger.info({ tool: tool.name, requiresApproval: tool.requiresApproval ?? false }, 'Tool registered');
  }

  /** Returns all registered tool definitions. */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Returns the definition for a single tool, or throws NOT_FOUND. */
  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new AppError(`Tool "${name}" not found`, 404, 'NOT_FOUND');
    }
    return tool;
  }

  /** Checks whether a tool is registered without throwing. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Returns JSON-serialisable manifests suitable for sending to the LLM API.
   */
  manifests(): ToolManifest[] {
    return this.list().map((t) => this.toManifest(t));
  }

  private toManifest(tool: ToolDefinition): ToolManifest {
    // We extract a minimal JSON Schema from the Zod schema.
    // For full JSON Schema conversion a library like `zod-to-json-schema` is
    // ideal; here we build a lightweight version that covers the common cases.
    let parameters: Record<string, unknown> = { type: 'object', properties: {} };

    try {
      // Attempt to pull the shape from a ZodObject for a proper JSON Schema.
      const shape = (tool.inputSchema as any)._def?.shape?.();
      if (shape) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
          const zodDef = (value as any)._def;
          const isOptional =
            zodDef?.typeName === 'ZodOptional' ||
            zodDef?.typeName === 'ZodDefault';

          if (!isOptional) required.push(key);

          // Map Zod type names to JSON Schema types
          const innerType = zodDef?.innerType?._def ?? zodDef;
          const typeName: string = innerType?.typeName ?? '';
          const jsonType =
            typeName === 'ZodString'  ? 'string'  :
            typeName === 'ZodNumber'  ? 'number'  :
            typeName === 'ZodBoolean' ? 'boolean' :
            typeName === 'ZodArray'   ? 'array'   :
            typeName === 'ZodObject'  ? 'object'  : 'string';

          properties[key] = {
            type: jsonType,
            ...(zodDef?.description && { description: zodDef.description }),
          };
        }

        parameters = {
          type: 'object',
          properties,
          ...(required.length > 0 && { required }),
        };
      }
    } catch {
      // Fall back to an empty object schema if introspection fails
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters,
      requiresApproval: tool.requiresApproval ?? false,
    };
  }
}

// Singleton — imported everywhere tools are needed.
export const toolRegistry = new ToolRegistry();
