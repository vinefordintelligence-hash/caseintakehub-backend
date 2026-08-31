import { ConflictException, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

@Injectable()
export class CaseReferenceService {
  async create<T>(insert: (caseReference: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      try {
        return await insert(this.reference());
      } catch (error: unknown) {
        if (!this.isUniqueViolation(error)) throw error;
      }
    }
    throw new ConflictException('unable to allocate a unique case reference');
  }

  private reference(now = new Date()): string {
    return `VF-${now.getUTCFullYear()}-${String(randomInt(0, 10_000)).padStart(4, '0')}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}
