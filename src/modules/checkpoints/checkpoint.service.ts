import { createHash } from 'crypto';
import { checkpointRepository } from './checkpoint.repository.js';
import { logger } from '../../common/logger/logger.js';
import type { AgentState } from '../workflows/workflow.types.js';
import type { Checkpoint } from '@prisma/client';

// ─── Serialisable state ───────────────────────────────────────────────────────
//
// BaseMessage objects from LangChain are not plain JSON — they carry class
// methods.  We serialise the messages array as a plain array of
// { type, content, tool_call_id? } objects and rehydrate on load.

interface SerializedMessage {
  type: 'human' | 'ai' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

function serializeState(state: AgentState): Record<string, unknown> {
  return {
    ...state,
    // Replace BaseMessage instances with plain objects
    messages: state.messages.map((m: any) => ({
      type: m._getType?.() ?? m.constructor?.name?.toLowerCase()?.replace('message', '') ?? 'ai',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}),
    })),
  };
}

function deserializeState(raw: Record<string, unknown>): AgentState {
  // Rehydrate messages as simple objects that satisfy the AgentState contract.
  // The nodes only need .content and ._getType() — we provide a minimal shim.
  const messages = ((raw.messages as SerializedMessage[]) ?? []).map((m) => {
    const msg: any = {
      content: m.content,
      _getType: () => m.type,
    };
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    return msg;
  });

  return { ...(raw as any), messages };
}

// ─── Nodes where checkpoints are saved ───────────────────────────────────────
//
// Checkpoints are written AFTER these nodes complete successfully.
// The list reflects "points where losing work is expensive".

export const CHECKPOINT_NODES = new Set([
  'plan',
  'retrieve',
  'retrieve_memory',
  'act',
  'observe',
  'respond',
  'WAITING_FOR_APPROVAL',
]);

// ─── Nodes kept during pruning ────────────────────────────────────────────────

const PRUNING_KEEP_NODES = new Set(['plan', 'respond']);

// ─── Checkpoint Service ───────────────────────────────────────────────────────

export class CheckpointService {
  /**
   * Save a checkpoint after a node completes.
   * Only saves for nodes listed in CHECKPOINT_NODES.
   */
  async save(
    tenantId: string,
    executionId: string,
    nodeName: string,
    state: AgentState,
    parentCheckpointId?: string,
  ): Promise<Checkpoint | null> {
    if (!CHECKPOINT_NODES.has(nodeName)) return null;

    const serialized = serializeState(state);

    const checkpoint = await checkpointRepository.create({
      tenantId,
      executionId,
      nodeName,
      state: serialized as any,
      ...(parentCheckpointId ? { parentCheckpointId } : {}),
    });

    logger.debug(
      { executionId, nodeName, checkpointId: checkpoint.id },
      'Checkpoint saved',
    );

    return checkpoint;
  }

  /**
   * Load the latest checkpoint for an execution.
   * Returns null if none exists (fresh run).
   */
  async loadLatest(executionId: string): Promise<{
    checkpoint: Checkpoint;
    state: AgentState;
  } | null> {
    const checkpoint = await checkpointRepository.findLatest(executionId);
    if (!checkpoint) return null;

    const state = deserializeState(checkpoint.state as Record<string, unknown>);

    logger.info(
      { executionId, nodeName: checkpoint.nodeName, checkpointId: checkpoint.id },
      'Checkpoint loaded for resume',
    );

    return { checkpoint, state };
  }

  /**
   * Prune intermediate checkpoints for a terminal execution.
   * Keeps: first, last, and any checkpoint at a WAITING_* node.
   */
  async prune(executionId: string): Promise<void> {
    const all = await checkpointRepository.findAll(executionId);
    if (all.length <= 2) return; // nothing to prune

    const keep = new Set<string>();

    // Always keep first and last
    keep.add(all[0]!.id);
    keep.add(all[all.length - 1]!.id);

    // Keep plan and respond checkpoints + any WAITING_* nodes
    for (const cp of all) {
      if (
        PRUNING_KEEP_NODES.has(cp.nodeName) ||
        cp.nodeName.startsWith('WAITING_')
      ) {
        keep.add(cp.id);
      }
    }

    const toDelete = all.map((cp) => cp.id).filter((id) => !keep.has(id));
    if (toDelete.length === 0) return;

    const deleted = await checkpointRepository.deleteMany(toDelete);
    logger.info({ executionId, deleted }, 'Checkpoints pruned');
  }
}

export const checkpointService = new CheckpointService();

// ─── Input hash helper ────────────────────────────────────────────────────────
//
// Used by the tool executor to deduplicate tool calls across retries.
// The hash is deterministic for the same tool name + input combination.

export function hashToolInput(toolName: string, input: Record<string, unknown>): string {
  const payload = JSON.stringify({ toolName, input }, Object.keys({ toolName, input }).sort());
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
