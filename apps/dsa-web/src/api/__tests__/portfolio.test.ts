import { beforeEach, describe, expect, it, vi } from 'vitest';
import { portfolioApi } from '../portfolio';

const get = vi.hoisted(() => vi.fn());

vi.mock('../index', () => ({
  default: { get },
}));

describe('portfolioApi.getPositionDiagnosis', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('serializes the position scope and converts nested diagnosis fields', async () => {
    get.mockResolvedValueOnce({
      data: {
        account_id: 7,
        account_name: 'Main',
        symbol: '600519',
        status: 'attention',
        valid_date: '2026-01-03',
        generation_mode: 'deterministic_rules',
        facts: { avg_cost: 100, price_provider: 'akshare' },
        calculations: { position_weight_pct: 42 },
        thresholds: { concentration_alert_pct: 35 },
        supporting_evidence: [],
        opposing_evidence: [],
        risk_triggers: [],
        watch_items: [],
        missing_data: ['buy_thesis'],
      },
    });

    const result = await portfolioApi.getPositionDiagnosis('600519', {
      accountId: 7,
      asOf: '2026-01-03',
      costMethod: 'avg',
      includeRealtime: false,
    });

    expect(get).toHaveBeenCalledWith(
      '/api/v1/portfolio/positions/600519/diagnosis',
      {
        params: {
          account_id: 7,
          as_of: '2026-01-03',
          cost_method: 'avg',
          include_realtime: 'false',
        },
      },
    );
    expect(result.accountId).toBe(7);
    expect(result.facts.avgCost).toBe(100);
    expect(result.calculations.positionWeightPct).toBe(42);
    expect(result.missingData).toEqual(['buy_thesis']);
  });
});
