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
    unavailableMetrics: ['win_rate', 'profit_loss_ratio', 'max_drawdown'],
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
    expect(screen.getByText(/当前样本少于 20 条/)).toBeInTheDocument();
    expect(screen.getByText(/胜率、盈亏比和最大回撤/)).toBeInTheDocument();
    expect(screen.getAllByText('计划内交易')).toHaveLength(2);
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
