import { executionsRepository } from './executions.repository.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import { NotFoundError } from '../../common/errors/HttpErrors.js';

export class ExecutionsService {
  async getExecution(executionId: string, tenantId: string, userId: string) {
    const execution = await executionsRepository.findById(executionId);
    if (!execution || execution.tenantId !== tenantId || execution.userId !== userId) {
      throw new NotFoundError('Execution');
    }
    return execution;
  }

  async listExecutions(chatId: string, limit: number, cursor?: string) {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    const items = await executionsRepository.findMany(chatId, limit, decodedCursor);
    return paginate(items, limit, (execution) => execution.id);
  }
}

export const executionsService = new ExecutionsService();
