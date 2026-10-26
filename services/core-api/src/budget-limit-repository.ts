import type { TripRepository } from './repository.js';
import { invalid } from './errors.js';
import type { CategoryLimit, CategoryLimitsInput } from './trip-planning-types.js';

const categories = ['accommodation', 'transport', 'food', 'activities', 'shopping', 'other'] as const;
type SpendingCategory = typeof categories[number];

function isCategory(value: string): value is SpendingCategory {
  return (categories as readonly string[]).includes(value);
}

function normalize(input: CategoryLimitsInput): CategoryLimit[] {
  const amounts = new Map<SpendingCategory, number>();
  const order: SpendingCategory[] = [];
  for (const row of input.limits) {
    if (!isCategory(row.category)) throw invalid('Choose a spending category.');
    if (!Number.isSafeInteger(row.limitPaise) || row.limitPaise < 0 || row.limitPaise > 1_000_000_000) {
      throw invalid('Use a category cap from ₹0 to ₹1,00,00,000.');
    }
    if (!amounts.has(row.category)) order.push(row.category);
    amounts.set(row.category, row.limitPaise);
  }
  return order.map((category) => ({ category, limitPaise: amounts.get(category)! }));
}

export class BudgetLimitRepository {
  constructor(private readonly core: TripRepository) {}

  async setCategoryLimits(actor: string, tripId: string, input: CategoryLimitsInput): Promise<CategoryLimit[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId, true);
      const limits = normalize(input);
      const stored: CategoryLimit[] = [];
      for (const limit of limits) {
        const [row] = await client.query<{ category: SpendingCategory; limitPaise: string | number }>(
          `INSERT INTO goa_core_budget_category_limits (trip_id, category, limit_paise, updated_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (trip_id, category) DO UPDATE SET limit_paise=EXCLUDED.limit_paise, updated_by=EXCLUDED.updated_by, updated_at=now()
           RETURNING category, limit_paise AS "limitPaise"`,
          [tripId, limit.category, limit.limitPaise, actor]);
        if (!row) throw invalid('The category cap could not be saved.');
        stored.push({ category: row.category, limitPaise: Number(row.limitPaise) });
      }
      if (limits.length) await this.core.audit(client, actor, tripId, 'budget_limit.updated', tripId, null);
      return stored;
    });
  }
}
