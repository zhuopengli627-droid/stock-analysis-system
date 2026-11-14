import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import TradeJournalPage from '../TradeJournalPage';

const { createTradeJournal, deleteTradeJournal, getAccounts, listTradeJournals } = vi.hoisted(() => ({
  createTradeJournal: vi.fn(),
  deleteTradeJournal: vi.fn(),
  getAccounts: vi.fn(),
  listTradeJournals: vi.fn(),
}));

vi.mock('../../api/portfolio', () => ({
  portfolioApi: { createTradeJournal, deleteTradeJournal, getAccounts, listTradeJournals },
}));

const journalResponse = {
  items: [{
    id: 4,
    accountId: 1,
    symbol: '600519',
    journalDate: '2026-01-03',
    side: 'buy' as const,
    reason: '回踩计划支撑位',
    plannedTrade: true,
    chasedPrice: false,
  }],
  total: 1,
  page: 1,
  pageSize: 100,
  summary: {
    total: 1,
    plannedCount: 1,
    unplannedCount: 0,
    chasedCount: 0,
    sampleSufficient: false,
    sampleWarning: 'sample warning',
    unavailableMetrics: ['max_drawdown'],
    performance: {
      available: true,
      dataQuality: 'ok',
      methodology: 'fifo_sell_execution',
      currency: 'CNY',
      realizedTradeCount: 2,
      evaluatedTradeCount: 2,
      winCount: 1,
      lossCount: 1,
      breakevenCount: 0,
      winRatePct: 50,
      averageWin: 90,
      averageLoss: -110,
      profitLossRatio: 0.818182,
      totalRealizedPnl: -20,
      matchedJournalCount: 2,
      ambiguousJournalCount: 0,
      unmatchedJournalCount: 0,
      nonRealizedJournalCount: 0,
      planned: { sampleCount: 1, winRatePct: 100, totalRealizedPnl: 90 },
      unplanned: { sampleCount: 1, winRatePct: 0, totalRealizedPnl: -110 },
    },
  },
};

describe('TradeJournalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('dsa.uiLanguage', 'zh');
    getAccounts.mockResolvedValue({ accounts: [{ id: 1, name: '主账户', market: 'cn', baseCurrency: 'CNY', isActive: true }] });
    listTradeJournals.mockResolvedValue(journalResponse);
    createTradeJournal.mockResolvedValue({ id: 5 });
    deleteTradeJournal.mockResolvedValue({ deleted: 1 });
  });

  it('shows discipline counts, small-sample warning, and persisted entries', async () => {
    render(<UiLanguageProvider><TradeJournalPage /></UiLanguageProvider>);

    expect(await screen.findByText('回踩计划支撑位')).toBeInTheDocument();
    expect(screen.getByText(/已实现卖出样本少于 20 笔/)).toBeInTheDocument();
    expect(screen.getByText(/绩效按每笔卖出成交计算/)).toBeInTheDocument();
    expect(screen.getAllByText('计划内交易')).toHaveLength(3);
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('0.82')).toBeInTheDocument();
  });

  it('submits the deterministic discipline fields and reloads the list', async () => {
    render(<UiLanguageProvider><TradeJournalPage /></UiLanguageProvider>);
    await screen.findByText('回踩计划支撑位');

    fireEvent.change(screen.getByLabelText('股票代码'), { target: { value: '159622' } });
    fireEvent.change(screen.getByLabelText('买卖理由'), { target: { value: '按计划分批买入' } });
    fireEvent.click(screen.getByLabelText('发生追高'));
    fireEvent.click(screen.getByRole('button', { name: '保存日志' }));

    await waitFor(() => expect(createTradeJournal).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 1,
      symbol: '159622',
      reason: '按计划分批买入',
      plannedTrade: true,
      chasedPrice: true,
    })));
    expect(listTradeJournals).toHaveBeenCalledTimes(2);
  });
});
