// ─── Execution ownership middleware ──────────────────────────────────────────
import { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, UnauthenticatedError } from '../errors/HttpErrors.js';

/** Loads req.params.executionId, asserts tenant+user ownership, attaches req.execution. */
export function executionOwnership() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const executionId = req.params.executionId;
      if (!executionId) throw new ValidationError('executionId is required');
      if (!req.user) throw new UnauthenticatedError();

      const execution = await prisma.execution.findUnique({ where: { id: executionId } });
      if (!execution || execution.tenantId !== req.user.tenantId || execution.userId !== req.user.id) {
        throw new NotFoundError('Execution');
      }

      req.execution = execution;
      next();
    } catch (error) {
      next(error);
    }
  };
}
