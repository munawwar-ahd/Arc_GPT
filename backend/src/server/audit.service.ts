import crypto from 'crypto';
import { databaseService } from './database.service.js';
import { describeError } from './errors.js';

export interface AuditEntry {
  requestId: string;
  userId: string;
  action: string;
  query?: string;
  resource?: string;
  status?: 'SUCCESS' | 'BLOCKED' | 'FAILED' | 'AMBIGUOUS';
  durationMs?: number;
  details?: string;
}

export class AuditService {
  public generateQueryHash(query?: string): string {
    if (!query) return 'N/A';
    return crypto.createHash('sha256').update(query.trim().toLowerCase()).digest('hex').substring(0, 16);
  }

  public async logEvent(entry: AuditEntry): Promise<void> {
    const queryHash = this.generateQueryHash(entry.query);
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'ArcGPT',
      requestId: entry.requestId,
      userId: entry.userId,
      action: entry.action,
      resource: entry.resource || 'SYSTEM',
      queryHash,
      status: entry.status,
      durationMs: entry.durationMs,
    }));

    try {
      await databaseService.insertAuditLog({
        user_id: entry.userId,
        action: entry.action,
        resource: entry.resource || 'SYSTEM',
        details: { requestId: entry.requestId, queryHash, details: entry.details, durationMs: entry.durationMs },
        result: entry.status || 'SUCCESS',
      });
    } catch (error) {
      console.error('[Audit] persistence failed:', describeError(error, 'unknown error'));
    }
  }
}

export const auditService = new AuditService();
