import { ApiError } from './errors.js';
import type { ActivityCategory, ExpenseCategory, ExpenseSplit } from './types.js';
import { invalid } from './errors.js';

export function allocateShares(amount: number, split: ExpenseSplit): { participantId: string; amountPaise: number }[] {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000) throw invalid('Use a positive amount in paise.');
  if (split.mode === 'none') return [];
  const ids = (split.mode === 'equal' ? split.participantIds : split.shares.map(share => share.participantId)).map(id => id.toLowerCase()).sort();
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length) throw invalid('Select from 1 to 50 different travellers.');
  if (split.mode === 'equal') {
    const count = BigInt(ids.length), total = BigInt(amount);
    return ids.map((participantId,index) => ({ participantId,amountPaise: Number(total / count + (BigInt(index) < total % count ? 1n : 0n)) }));
  }
  if (split.shares.some(share => !Number.isSafeInteger(share.amountPaise) || share.amountPaise < 0 || share.amountPaise > 1_000_000_000) ||
    exactTotal(split.shares.map(share => share.amountPaise)) !== amount) throw invalid('Custom shares must add up exactly to the paid amount.');
  return split.shares.map(share => ({ ...share,participantId: share.participantId.toLowerCase() })).sort((a,b) => a.participantId.localeCompare(b.participantId));
}

export function exactTotal(values: number[]): number {
  return safeNumber(values.reduce((total, value) => total + BigInt(value), 0n));
}
export function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ApiError(409, 'CONFLICT', 'The trip total exceeds the supported money range.');
  }
  return Number(value);
}
export function perPerson(total: number, travellers: number): number {
  const count = BigInt(travellers);
  return safeNumber((BigInt(total) + count / 2n) / count);
}
export function plannedCategory(category: ActivityCategory): ExpenseCategory {
  if (['beach', 'culture', 'adventure', 'nightlife'].includes(category)) return 'activities';
  if (category === 'cafe' || category === 'food') return 'food';
  if (category === 'shopping' || category === 'transport') return category;
  return 'other';
}
