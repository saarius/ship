// Strict merchant-only label command. No postage, cancel, re-buy or admission control.
import { ServiceError } from '../../service/src/errors.js';
import { admissionCommand } from './admission.js';
export interface PracticeCommand { action: 'create' | 'print'; revision: number; orderId: string; version: number; boxId?: string; weightOz?: number; by?: string }
export async function practiceCommand(request: Request): Promise<PracticeCommand> {
  const value = await admissionCommand(request);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const body = value as Record<string, unknown>;
  const keys = body.action === 'create' ? 'action,boxId,by,orderId,revision,version,weightOz' : 'action,orderId,revision,version';
  if (!['create', 'print'].includes(String(body.action)) || Object.keys(body).sort().join() !== keys ||
      !Number.isSafeInteger(body.revision) || (body.revision as number) < 0 || !Number.isSafeInteger(body.version) || (body.version as number) < 1 ||
      typeof body.orderId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(body.orderId)) return invalid();
  if (body.action === 'create' && (typeof body.boxId !== 'string' || !/^box_[A-Za-z0-9-]{1,80}$/.test(body.boxId) ||
      typeof body.weightOz !== 'number' || !Number.isFinite(body.weightOz) || body.weightOz < 0.1 || body.weightOz > 1120 ||
      typeof body.by !== 'string' || !body.by.trim() || body.by.length > 200 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(body.by))) return invalid();
  return body as unknown as PracticeCommand;
}
function invalid(): never { throw new ServiceError(400, 'INVALID_INPUT', 'Use the current practice-label form without extra fields.'); }
