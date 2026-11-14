import { beforeEach, describe, expect, it, vi } from 'vitest';
import { portfolioApi } from '../portfolio';

const { deleteRequest, get, post, put } = vi.hoisted(() => ({
  deleteRequest: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock('../index', () => ({
  default: { delete: deleteRequest, get, post, put },
}));

describe('portfolioApi.getPositionDiagnosis', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    deleteRequest.mockReset();
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
        strategy_profile: {},
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

  it('serializes a journal entry and converts its discipline summary', async () => {
    post.mockResolvedValueOnce({ data: { id: 9, account_id: 2, symbol: '600519' } });
    get.mockResolvedValueOnce({
      data: {
        items: [],
        total: 1,
        page: 1,
        page_size: 100,
        summary: {
          total: 1,
          planned_count: 1,
          unplanned_count: 0,
          chased_count: 0,
          sample_sufficient: false,
          sample_warning: 'sample warning',
          unavailable_metrics: ['max_drawdown'],
          performance: {
            available: true,
            data_quality: 'ok',
            methodology: 'fifo_sell_execution',
            currency: 'CNY',
            realized_trade_count: 2,
            evaluated_trade_count: 2,
            win_count: 1,
            loss_count: 1,
            breakeven_count: 0,
            win_rate_pct: 50,
            average_win: 90,
            average_loss: -110,
            profit_loss_ratio: 0.818182,
            total_realized_pnl: -20,
            matched_journal_count: 2,
            ambiguous_journal_count: 0,
            unmatched_journal_count: 0,
            non_realized_journal_count: 0,
            planned: { sample_count: 1, win_rate_pct: 100, total_realized_pnl: 90 },
            unplanned: { sample_count: 1, win_rate_pct: 0, total_realized_pnl: -110 },
          },
        },
      },
    });

    await portfolioApi.createTradeJournal({
      accountId: 2,
      symbol: '600519',
      journalDate: '2026-01-03',
      side: 'buy',
      reason: 'planned support entry',
      plannedTrade: true,
      chasedPrice: false,
    });
    const listed = await portfolioApi.listTradeJournals(2);

    expect(post).toHaveBeenCalledWith('/api/v1/portfolio/trade-journal', expect.objectContaining({
      account_id: 2,
      planned_trade: true,
      chased_price: false,
    }));
    expect(get).toHaveBeenCalledWith('/api/v1/portfolio/trade-journal', {
      params: { account_id: 2, page: 1, page_size: 100 },
    });
    expect(listed.summary.plannedCount).toBe(1);
    expect(listed.summary.sampleSufficient).toBe(false);
    expect(listed.summary.performance.winRatePct).toBe(50);
  });
});
