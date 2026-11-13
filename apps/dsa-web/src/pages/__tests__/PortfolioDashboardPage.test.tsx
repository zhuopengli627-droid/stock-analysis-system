import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UiLanguageProvider } from '../../contexts/UiLanguageContext';
import { UI_LANGUAGE_STORAGE_KEY } from '../../utils/uiLanguage';
import PortfolioDashboardPage from '../PortfolioDashboardPage';

const {
  getSnapshot,
  getRisk,
  listReviews,
  getReview,
  listReviewVerifications,
  createReview,
  verifyReview,
  getPositionDiagnosis,
} = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getRisk: vi.fn(),
  listReviews: vi.fn(),
  getReview: vi.fn(),
  listReviewVerifications: vi.fn(),
  createReview: vi.fn(),
  verifyReview: vi.fn(),
  getPositionDiagnosis: vi.fn(),
}));

vi.mock('../../api/portfolio', () => ({
  portfolioApi: {
    getSnapshot,
    getRisk,
    listReviews,
    getReview,
    listReviewVerifications,
    createReview,
    verifyReview,
    getPositionDiagnosis,
  },
}));

function makeSnapshot(withPosition = true) {
  return {
    asOf: '2026-11-13',
    costMethod: 'fifo' as const,
    currency: 'CNY',
    accountCount: 1,
    totalCash: 30_000,
    totalMarketValue: withPosition ? 150_000 : 0,
    totalEquity: withPosition ? 180_000 : 30_000,
    realizedPnl: 1_200,
    unrealizedPnl: withPosition ? -800 : 0,
    feeTotal: 35,
    taxTotal: 0,
    fxStale: false,
    dataQuality: 'ok',
    limitations: [],
    accounts: [{
      accountId: 1,
      accountName: '主账户',
      broker: '华泰',
      market: 'cn',
      baseCurrency: 'CNY',
      asOf: '2026-11-13',
      costMethod: 'fifo' as const,
      totalCash: 30_000,
      totalMarketValue: withPosition ? 150_000 : 0,
      totalEquity: withPosition ? 180_000 : 30_000,
      realizedPnl: 1_200,
      unrealizedPnl: withPosition ? -800 : 0,
      feeTotal: 35,
      taxTotal: 0,
      fxStale: false,
      positions: withPosition ? [{
        symbol: '600519',
        market: 'cn',
        currency: 'CNY',
        quantity: 100,
        avgCost: 1580,
        totalCost: 158_000,
        lastPrice: 1500,
        marketValueBase: 150_000,
        unrealizedPnlBase: -8_000,
        unrealizedPnlPct: -5.06,
        valuationCurrency: 'CNY',
        priceSource: 'history_close',
        priceProvider: 'akshare',
        priceDate: '2026-11-13',
        priceStale: false,
        priceAvailable: true,
      }] : [],
    }],
  };
}

function makeRisk() {
  return {
    asOf: '2026-11-13',
    accountId: null,
    costMethod: 'fifo' as const,
    currency: 'CNY',
    thresholds: {},
    concentration: {
      totalMarketValue: 150_000,
      topWeightPct: 83.33,
      alert: true,
      topPositions: [{ symbol: '600519', marketValueBase: 150_000, weightPct: 83.33, isAlert: true }],
    },
    sectorConcentration: {
      totalMarketValue: 0,
      topWeightPct: 0,
      alert: false,
      topSectors: [],
      coverage: {},
      errors: [],
    },
    drawdown: { seriesPoints: 2, maxDrawdownPct: -4, currentDrawdownPct: -2, alert: false, fxStale: false },
    stopLoss: { nearAlert: false, triggeredCount: 0, nearCount: 0, items: [] },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <UiLanguageProvider>
        <PortfolioDashboardPage />
      </UiLanguageProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh');
  getSnapshot.mockResolvedValue(makeSnapshot());
  getRisk.mockResolvedValue(makeRisk());
  listReviews.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  createReview.mockResolvedValue({ id: 9 });
  getPositionDiagnosis.mockResolvedValue({
    accountId: 1,
    accountName: '主账户',
    symbol: '600519',
    status: 'attention',
    validDate: '2026-11-13',
    generationMode: 'deterministic_rules',
    facts: {
      quantity: 100,
      avgCost: 1580,
      lastPrice: 1500,
      priceProvider: 'akshare',
      priceDate: '2026-11-13',
    },
    calculations: {
      marketValue: 150_000,
      unrealizedPnl: -8_000,
      unrealizedPnlPct: -5.06,
      positionWeightPct: 83.33,
    },
    thresholds: {
      concentrationAlertPct: 35,
      stopLossAlertPct: 10,
      stopLossNearPct: 8,
    },
    supportingEvidence: [{ code: 'price_fresh', message: '价格数据可用且未标记陈旧。', source: 'portfolio_snapshot.position.price' }],
    opposingEvidence: [{ code: 'concentration_limit_exceeded', message: '该持仓触发账户单一持仓集中度阈值。', source: 'portfolio_rule.concentration' }],
    riskTriggers: [{ code: 'concentration_limit_exceeded', message: '单一持仓集中度超限。', source: 'portfolio_rule.concentration' }],
    watchItems: [{ code: 'review_position_concentration', message: '复核该持仓的仓位和原交易计划。', source: 'portfolio_rule.concentration' }],
    missingData: ['buy_thesis', 'risk_budget'],
  });
});

describe('PortfolioDashboardPage', () => {
  it('renders real totals, position diagnostics, and deterministic watch items', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '投资总览' })).toBeInTheDocument();
    expect(screen.getByText('CNY 180,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('83.33%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('600519').length).toBeGreaterThan(0);
    expect(screen.getByText('-5.06%')).toBeInTheDocument();
    expect(screen.getByText('观察')).toBeInTheDocument();
    expect(screen.getByText(/检查集中持仓/)).toBeInTheDocument();
    expect(screen.getByText('缺少日初快照，暂不计算')).toBeInTheDocument();
  });

  it('shows a truthful empty state instead of demo holdings', async () => {
    getSnapshot.mockResolvedValue(makeSnapshot(false));
    getRisk.mockResolvedValue({
      ...makeRisk(),
      concentration: { totalMarketValue: 0, topWeightPct: 0, alert: false, topPositions: [] },
    });

    renderPage();

    expect(await screen.findByText('暂无持仓')).toBeInTheDocument();
    expect(screen.getByText('当前没有由确定性规则生成的观察项。')).toBeInTheDocument();
    expect(screen.queryByText('600519')).not.toBeInTheDocument();
  });

  it('keeps snapshot data visible when the risk endpoint degrades', async () => {
    getRisk.mockRejectedValue(new Error('risk unavailable'));

    renderPage();

    expect(await screen.findByText('CNY 180,000.00')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('risk unavailable');
  });

  it('generates a new versioned review and refreshes the dashboard', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '投资总览' });

    fireEvent.click(screen.getByRole('button', { name: /生成今日复盘/ }));

    await waitFor(() => expect(createReview).toHaveBeenCalledWith({ includeRealtime: false }));
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
  });

  it('opens a traceable deterministic diagnosis for a held position', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '投资总览' });

    fireEvent.click(screen.getByRole('button', { name: /查看诊断/ }));

    expect(await screen.findByTestId('portfolio-position-diagnosis')).toBeInTheDocument();
    expect(screen.getByText('确定性规则')).toBeInTheDocument();
    expect(screen.getByText('该持仓触发账户单一持仓集中度阈值。')).toBeInTheDocument();
    expect(screen.getAllByText('portfolio_rule.concentration')).toHaveLength(3);
    expect(screen.getByText('买入逻辑')).toBeInTheDocument();
    expect(screen.getByText('风险预算')).toBeInTheDocument();
    expect(getPositionDiagnosis).toHaveBeenCalledWith('600519', {
      accountId: 1,
      asOf: '2026-11-13',
      costMethod: 'fifo',
      includeRealtime: false,
    });
  });

  it('loads and verifies the latest immutable review', async () => {
    listReviews.mockResolvedValue({
      items: [{ id: 3, reviewDate: '2026-11-12', version: 2, costMethod: 'fifo', generationMode: 'rules', dataQuality: 'ok' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    getReview.mockResolvedValue({
      id: 3,
      reviewDate: '2026-11-12',
      version: 2,
      costMethod: 'fifo',
      generationMode: 'rules',
      dataQuality: 'ok',
      payload: { facts: { totalEquity: 179000 } },
    });
    listReviewVerifications.mockResolvedValue({ items: [], total: 0 });
    verifyReview.mockResolvedValue({
      id: 5,
      reviewId: 3,
      asOf: '2026-11-13',
      status: 'verified_true',
      method: 'next_close',
      details: {},
    });

    renderPage();

    expect(await screen.findByText('2026-11-12 · 版本 2 · 规则报告')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /验证上次判断/ }));
    expect(await screen.findByText('已验证成立')).toBeInTheDocument();
    expect(verifyReview).toHaveBeenCalledWith(3);
  });
});
