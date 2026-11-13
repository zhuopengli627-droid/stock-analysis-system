import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  WalletCards,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { portfolioApi } from '../api/portfolio';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { ApiErrorAlert, Badge, Button, Card, Drawer, EmptyState, InlineAlert, Loading } from '../components/common';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type {
  PortfolioPositionItem,
  PortfolioPositionDiagnosisResponse,
  PortfolioReviewItem,
  PortfolioReviewVerificationItem,
  PortfolioRiskResponse,
  PortfolioSnapshotResponse,
} from '../types/portfolio';
import { formatMoney, formatPct, formatSignedPct, hasPositionPrice } from '../utils/portfolioFormat';

type DashboardPosition = PortfolioPositionItem & {
  accountId: number;
  accountName: string;
};

type DashboardTexts = {
  title: string;
  description: string;
  refresh: string;
  refreshing: string;
  manage: string;
  netAssets: string;
  todayPnl: string;
  cumulativePnl: string;
  exposure: string;
  marketValue: string;
  cash: string;
  noOpeningSnapshot: string;
  bookedAndFloating: string;
  riskOverview: string;
  concentration: string;
  currentDrawdown: string;
  stopLoss: string;
  financing: string;
  notRecorded: string;
  triggered: string;
  near: string;
  normal: string;
  dataQuality: string;
  positions: string;
  positionDescription: string;
  noPositions: string;
  noPositionsDescription: string;
  account: string;
  symbol: string;
  quantity: string;
  price: string;
  value: string;
  pnl: string;
  status: string;
  priceMissing: string;
  priceStale: string;
  riskTriggered: string;
  observe: string;
  stable: string;
  latestReview: string;
  createReview: string;
  creatingReview: string;
  noReview: string;
  noReviewDescription: string;
  ruleReview: string;
  version: string;
  verify: string;
  verifying: string;
  verification: string;
  verificationEmpty: string;
  watchlist: string;
  noWatchItems: string;
  staleQuotes: string;
  missingQuotes: string;
  concentratedPosition: string;
  stopLossSymbols: string;
  fxStale: string;
  qualityOk: string;
  qualityPartial: string;
  viewDiagnosis: string;
  diagnosisTitle: string;
  loadingDiagnosis: string;
  deterministicRules: string;
  validDate: string;
  factsAndCalculations: string;
  supportingEvidence: string;
  opposingEvidence: string;
  riskTriggers: string;
  watchItems: string;
  missingData: string;
  noEvidence: string;
  averageCost: string;
  positionWeight: string;
  priceSource: string;
};

const DASHBOARD_TEXT: Record<'zh' | 'en', DashboardTexts> = {
  zh: {
    title: '投资总览',
    description: '聚合真实账本、行情质量、风险规则和每日复盘，不用演示数据补齐缺口。',
    refresh: '刷新数据',
    refreshing: '刷新中',
    manage: '持仓管理',
    netAssets: '当前净资产',
    todayPnl: '今日盈亏',
    cumulativePnl: '累计账面盈亏',
    exposure: '当前仓位',
    marketValue: '持仓市值',
    cash: '现金余额',
    noOpeningSnapshot: '缺少日初快照，暂不计算',
    bookedAndFloating: '已实现 + 未实现',
    riskOverview: '账户风险雷达',
    concentration: '最大单一持仓',
    currentDrawdown: '当前回撤',
    stopLoss: '止损规则',
    financing: '融资负债',
    notRecorded: '尚未录入负债账本',
    triggered: '触发',
    near: '临近',
    normal: '正常',
    dataQuality: '数据质量',
    positions: '持仓诊断',
    positionDescription: '状态仅由价格可用性和确定性风险规则计算。',
    noPositions: '暂无持仓',
    noPositionsDescription: '导入真实成交或录入交易后，这里会展示逐只持仓状态。',
    account: '账户',
    symbol: '代码',
    quantity: '数量',
    price: '价格',
    value: '市值',
    pnl: '浮动盈亏',
    status: '规则状态',
    priceMissing: '缺少行情',
    priceStale: '行情陈旧',
    riskTriggered: '风险触发',
    observe: '观察',
    stable: '稳定',
    latestReview: '最新每日复盘',
    createReview: '生成今日复盘',
    creatingReview: '生成中',
    noReview: '尚未生成复盘',
    noReviewDescription: '报告会保存版本化 JSON 和 Markdown，并保留后续验证记录。',
    ruleReview: '规则报告',
    version: '版本',
    verify: '验证上次判断',
    verifying: '验证中',
    verification: '最近验证',
    verificationEmpty: '尚无验证记录',
    watchlist: '下一交易日观察清单',
    noWatchItems: '当前没有由确定性规则生成的观察项。',
    staleQuotes: '复核陈旧行情',
    missingQuotes: '补齐缺失行情',
    concentratedPosition: '检查集中持仓',
    stopLossSymbols: '检查止损触发',
    fxStale: '汇率存在过期或回退数据',
    qualityOk: '完整',
    qualityPartial: '部分可用',
    viewDiagnosis: '查看诊断',
    diagnosisTitle: '持仓结构化诊断',
    loadingDiagnosis: '加载诊断中',
    deterministicRules: '确定性规则',
    validDate: '结论有效日期',
    factsAndCalculations: '事实与计算结果',
    supportingEvidence: '支持继续持有的证据',
    opposingEvidence: '反对继续持有的证据',
    riskTriggers: '风险触发条件',
    watchItems: '下一交易日观察事项',
    missingData: '缺失的数据',
    noEvidence: '当前无对应证据。',
    averageCost: '平均成本',
    positionWeight: '账户持仓权重',
    priceSource: '价格来源',
  },
  en: {
    title: 'Investment overview',
    description: 'A truthful view of ledger data, quote quality, risk rules, and versioned daily reviews.',
    refresh: 'Refresh',
    refreshing: 'Refreshing',
    manage: 'Manage portfolio',
    netAssets: 'Net assets',
    todayPnl: 'Today P&L',
    cumulativePnl: 'Cumulative book P&L',
    exposure: 'Exposure',
    marketValue: 'Market value',
    cash: 'Cash balance',
    noOpeningSnapshot: 'Opening snapshot unavailable',
    bookedAndFloating: 'Realized + unrealized',
    riskOverview: 'Account risk radar',
    concentration: 'Largest position',
    currentDrawdown: 'Current drawdown',
    stopLoss: 'Stop-loss rules',
    financing: 'Financing debt',
    notRecorded: 'Debt ledger not available',
    triggered: 'Triggered',
    near: 'Near',
    normal: 'Normal',
    dataQuality: 'Data quality',
    positions: 'Position diagnostics',
    positionDescription: 'Statuses are calculated only from quote quality and deterministic rules.',
    noPositions: 'No positions',
    noPositionsDescription: 'Import real trades or add transactions to see position-level diagnostics.',
    account: 'Account',
    symbol: 'Symbol',
    quantity: 'Quantity',
    price: 'Price',
    value: 'Value',
    pnl: 'Unrealized P&L',
    status: 'Rule status',
    priceMissing: 'Quote missing',
    priceStale: 'Quote stale',
    riskTriggered: 'Risk triggered',
    observe: 'Observe',
    stable: 'Stable',
    latestReview: 'Latest daily review',
    createReview: 'Generate today review',
    creatingReview: 'Generating',
    noReview: 'No review yet',
    noReviewDescription: 'Each report stores immutable JSON and Markdown with later verification history.',
    ruleReview: 'Rules report',
    version: 'Version',
    verify: 'Verify prior judgment',
    verifying: 'Verifying',
    verification: 'Latest verification',
    verificationEmpty: 'No verification record',
    watchlist: 'Next-session watchlist',
    noWatchItems: 'No deterministic watch item is currently active.',
    staleQuotes: 'Review stale quotes',
    missingQuotes: 'Resolve missing quotes',
    concentratedPosition: 'Review concentrated position',
    stopLossSymbols: 'Review stop-loss trigger',
    fxStale: 'FX data contains stale or fallback rates',
    qualityOk: 'Complete',
    qualityPartial: 'Partial',
    viewDiagnosis: 'View diagnosis',
    diagnosisTitle: 'Structured position diagnosis',
    loadingDiagnosis: 'Loading diagnosis',
    deterministicRules: 'Deterministic rules',
    validDate: 'Valid date',
    factsAndCalculations: 'Facts and calculations',
    supportingEvidence: 'Evidence supporting the position',
    opposingEvidence: 'Evidence opposing the position',
    riskTriggers: 'Risk triggers',
    watchItems: 'Next-session watch items',
    missingData: 'Missing data',
    noEvidence: 'No evidence in this category.',
    averageCost: 'Average cost',
    positionWeight: 'Account position weight',
    priceSource: 'Price source',
  },
};

const MISSING_DATA_LABELS: Record<string, { zh: string; en: string }> = {
  buy_thesis: { zh: '买入逻辑', en: 'Buy thesis' },
  target_holding_period: { zh: '目标持有周期', en: 'Target holding period' },
  invalidation_condition: { zh: '计划失效条件', en: 'Invalidation condition' },
  risk_budget: { zh: '风险预算', en: 'Risk budget' },
  position_limit: { zh: '仓位限制', en: 'Position limit' },
  add_reduce_conditions: { zh: '加减仓观察条件', en: 'Add/reduce conditions' },
  current_price: { zh: '当前可用价格', en: 'Current usable price' },
};

function verificationLabel(status: string | undefined, language: 'zh' | 'en'): string {
  const labels: Record<string, [string, string]> = {
    verified_true: ['已验证成立', 'Verified true'],
    verified_false: ['已验证不成立', 'Verified false'],
    pending: ['尚未到验证期限', 'Pending'],
    insufficient_data: ['数据不足', 'Insufficient data'],
    not_automatable: ['不能自动验证', 'Not automatable'],
  };
  const pair = labels[status ?? ''];
  return pair ? pair[language === 'zh' ? 0 : 1] : (language === 'zh' ? '尚无验证记录' : 'No verification record');
}

function verificationVariant(status: string | undefined): 'success' | 'danger' | 'warning' | 'default' {
  if (status === 'verified_true') return 'success';
  if (status === 'verified_false') return 'danger';
  if (status === 'pending' || status === 'insufficient_data') return 'warning';
  return 'default';
}

function positionStatus(row: DashboardPosition, text: DashboardTexts): {
  label: string;
  variant: 'success' | 'danger' | 'warning';
} {
  if (!hasPositionPrice(row)) return { label: text.priceMissing, variant: 'danger' };
  if (row.priceStale) return { label: text.priceStale, variant: 'warning' };
  if ((row.unrealizedPnlPct ?? 0) <= -10) return { label: text.riskTriggered, variant: 'danger' };
  if ((row.unrealizedPnlPct ?? 0) < 0) return { label: text.observe, variant: 'warning' };
  return { label: text.stable, variant: 'success' };
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : '--';
}

function diagnosisStatusView(
  status: PortfolioPositionDiagnosisResponse['status'],
  text: DashboardTexts,
): { label: string; variant: 'success' | 'warning' | 'danger' } {
  if (status === 'stable') return { label: text.stable, variant: 'success' };
  if (status === 'attention') return { label: text.observe, variant: 'warning' };
  if (status === 'risk_triggered') return { label: text.riskTriggered, variant: 'danger' };
  return { label: text.priceMissing, variant: 'danger' };
}

const EvidenceList: React.FC<{
  title: string;
  items: PortfolioPositionDiagnosisResponse['supportingEvidence'];
  emptyLabel: string;
}> = ({ title, items, emptyLabel }) => (
  <section className="rounded-2xl border border-border/60 bg-surface/40 p-4">
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    {items.length ? (
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={`${item.code}-${item.source}`} className="rounded-xl border border-border/50 bg-card/60 px-3 py-2.5">
            <p className="text-sm leading-5 text-foreground">{item.message}</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-text">{item.source}</p>
          </li>
        ))}
      </ul>
    ) : <p className="mt-3 text-sm text-secondary-text">{emptyLabel}</p>}
  </section>
);

const PortfolioDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useUiLanguage();
  const text = DASHBOARD_TEXT[language];
  const [snapshot, setSnapshot] = useState<PortfolioSnapshotResponse | null>(null);
  const [risk, setRisk] = useState<PortfolioRiskResponse | null>(null);
  const [latestReview, setLatestReview] = useState<PortfolioReviewItem | null>(null);
  const [latestVerification, setLatestVerification] = useState<PortfolioReviewVerificationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingReview, setCreatingReview] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<DashboardPosition | null>(null);
  const [diagnosis, setDiagnosis] = useState<PortfolioPositionDiagnosisResponse | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState<ParsedApiError | null>(null);

  const loadDashboard = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError(null);
    setWarning(null);
    const [snapshotResult, riskResult, reviewsResult] = await Promise.allSettled([
      portfolioApi.getSnapshot({ includeRealtime: false }),
      portfolioApi.getRisk({ includeRealtime: false }),
      portfolioApi.listReviews(),
    ]);

    if (snapshotResult.status === 'fulfilled') {
      setSnapshot(snapshotResult.value);
    } else {
      setSnapshot(null);
      setError(getParsedApiError(snapshotResult.reason));
    }

    if (riskResult.status === 'fulfilled') {
      setRisk(riskResult.value);
    } else {
      setRisk(null);
      setWarning(getParsedApiError(riskResult.reason).message);
    }

    if (reviewsResult.status === 'fulfilled' && reviewsResult.value.items[0]) {
      const reviewId = reviewsResult.value.items[0].id;
      const [reviewResult, verificationResult] = await Promise.allSettled([
        portfolioApi.getReview(reviewId),
        portfolioApi.listReviewVerifications(reviewId),
      ]);
      setLatestReview(reviewResult.status === 'fulfilled' ? reviewResult.value : reviewsResult.value.items[0]);
      setLatestVerification(
        verificationResult.status === 'fulfilled'
          ? verificationResult.value.items[0] ?? null
          : null,
      );
    } else {
      setLatestReview(null);
      setLatestVerification(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDashboard();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadDashboard]);

  const positions = useMemo<DashboardPosition[]>(() => (
    (snapshot?.accounts ?? [])
      .flatMap((account) => account.positions.map((position) => ({
        ...position,
        accountId: account.accountId,
        accountName: account.accountName,
      })))
      .sort((left, right) => right.marketValueBase - left.marketValueBase)
  ), [snapshot]);

  const exposurePct = snapshot && snapshot.totalEquity > 0
    ? (snapshot.totalMarketValue / snapshot.totalEquity) * 100
    : null;
  const cumulativePnl = snapshot ? snapshot.realizedPnl + snapshot.unrealizedPnl : null;
  const missingQuotes = positions.filter((row) => !hasPositionPrice(row));
  const staleQuotes = positions.filter((row) => hasPositionPrice(row) && row.priceStale);
  const stopLossSymbols = risk?.stopLoss.items.filter((item) => item.isTriggered).map((item) => item.symbol) ?? [];
  const topPosition = risk?.concentration.topPositions[0];
  const watchItems = [
    ...(missingQuotes.length ? [`${text.missingQuotes}: ${missingQuotes.map((item) => item.symbol).join('、')}`] : []),
    ...(staleQuotes.length ? [`${text.staleQuotes}: ${staleQuotes.map((item) => item.symbol).join('、')}`] : []),
    ...(risk?.concentration.alert && topPosition ? [`${text.concentratedPosition}: ${topPosition.symbol} (${formatPct(topPosition.weightPct)})`] : []),
    ...(stopLossSymbols.length ? [`${text.stopLossSymbols}: ${stopLossSymbols.join('、')}`] : []),
    ...(snapshot?.fxStale ? [text.fxStale] : []),
  ];

  const handleCreateReview = async () => {
    setCreatingReview(true);
    setError(null);
    try {
      await portfolioApi.createReview({ includeRealtime: false });
      await loadDashboard();
    } catch (caught) {
      setError(getParsedApiError(caught));
    } finally {
      setCreatingReview(false);
    }
  };

  const handleVerify = async () => {
    if (!latestReview) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await portfolioApi.verifyReview(latestReview.id);
      setLatestVerification(result);
    } catch (caught) {
      setError(getParsedApiError(caught));
    } finally {
      setVerifying(false);
    }
  };

  const handleOpenDiagnosis = async (row: DashboardPosition) => {
    setSelectedPosition(row);
    setDiagnosis(null);
    setDiagnosisError(null);
    setDiagnosisLoading(true);
    try {
      const result = await portfolioApi.getPositionDiagnosis(row.symbol, {
        accountId: row.accountId,
        asOf: snapshot?.asOf,
        costMethod: snapshot?.costMethod ?? 'fifo',
        includeRealtime: false,
      });
      setDiagnosis(result);
    } catch (caught) {
      setDiagnosisError(getParsedApiError(caught));
    } finally {
      setDiagnosisLoading(false);
    }
  };

  if (loading && !snapshot) {
    return <Loading label={text.refreshing} className="min-h-[60vh]" />;
  }

  const qualityPartial = snapshot?.dataQuality === 'partial' || snapshot?.fxStale || missingQuotes.length > 0 || staleQuotes.length > 0;

  return (
    <div className="min-h-screen space-y-4 p-4 md:p-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/78 p-5 shadow-soft-card md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Badge variant={qualityPartial ? 'warning' : 'success'}>
                {text.dataQuality}: {qualityPartial ? text.qualityPartial : text.qualityOk}
              </Badge>
              <span className="text-xs text-muted-text">{snapshot?.asOf ?? '--'}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{text.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-text">{text.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void loadDashboard()} isLoading={loading} loadingText={text.refreshing}>
              <RefreshCw className="h-4 w-4" />
              {text.refresh}
            </Button>
            <Button onClick={() => navigate('/portfolio')}>
              <BriefcaseBusiness className="h-4 w-4" />
              {text.manage}
            </Button>
          </div>
        </div>
      </section>

      {error ? <ApiErrorAlert error={error} onDismiss={() => setError(null)} /> : null}
      {warning ? <InlineAlert variant="warning" message={warning} /> : null}
      {snapshot?.limitations?.length ? (
        <InlineAlert variant="warning" title={text.dataQuality} message={snapshot.limitations.join('；')} />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: text.netAssets, value: formatMoney(snapshot?.totalEquity, snapshot?.currency), detail: `${text.cash}: ${formatMoney(snapshot?.totalCash, snapshot?.currency)}`, icon: WalletCards, tone: 'text-cyan' },
          { label: text.todayPnl, value: '--', detail: text.noOpeningSnapshot, icon: CalendarClock, tone: 'text-secondary-text' },
          { label: text.cumulativePnl, value: formatMoney(cumulativePnl, snapshot?.currency), detail: text.bookedAndFloating, icon: CircleDollarSign, tone: (cumulativePnl ?? 0) >= 0 ? 'text-success' : 'text-danger' },
          { label: text.exposure, value: formatPct(exposurePct), detail: `${text.marketValue}: ${formatMoney(snapshot?.totalMarketValue, snapshot?.currency)}`, icon: Gauge, tone: 'text-purple' },
        ].map(({ label, value, detail, icon: Icon, tone }) => (
          <Card key={label} padding="md" className="min-h-36">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-text">{label}</p>
                <p className="mt-4 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
                <p className="mt-2 text-xs text-secondary-text">{detail}</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-surface/65 p-2.5">
                <Icon className={`h-5 w-5 ${tone}`} />
              </div>
            </div>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.45fr_0.75fr]">
        <Card padding="none" className="overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{text.positions}</h2>
              <p className="mt-1 text-xs text-secondary-text">{text.positionDescription}</p>
            </div>
            <Badge variant="info">{positions.length}</Badge>
          </div>
          {positions.length === 0 ? (
            <EmptyState
              className="m-5"
              icon={<BriefcaseBusiness className="h-8 w-8" />}
              title={text.noPositions}
              description={text.noPositionsDescription}
              action={<Button size="sm" onClick={() => navigate('/portfolio')}>{text.manage}</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-surface/55 text-left text-xs text-muted-text">
                  <tr>
                    <th className="px-5 py-3 font-medium">{text.symbol}</th>
                    <th className="px-3 py-3 font-medium">{text.account}</th>
                    <th className="px-3 py-3 text-right font-medium">{text.quantity}</th>
                    <th className="px-3 py-3 text-right font-medium">{text.price}</th>
                    <th className="px-3 py-3 text-right font-medium">{text.value}</th>
                    <th className="px-3 py-3 text-right font-medium">{text.pnl}</th>
                    <th className="px-5 py-3 text-right font-medium">{text.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/55">
                  {positions.map((row) => {
                    const status = positionStatus(row, text);
                    return (
                      <tr key={`${row.accountId}-${row.market}-${row.symbol}`} className="transition-colors hover:bg-hover/45">
                        <td className="px-5 py-3.5">
                          <div className="font-mono font-semibold text-foreground">{row.symbol}</div>
                          <div className="mt-1 text-[11px] uppercase text-muted-text">{row.market} · {row.currency}</div>
                        </td>
                        <td className="px-3 py-3.5 text-secondary-text">{row.accountName}</td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-foreground">{row.quantity.toLocaleString('zh-CN')}</td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-foreground">
                          {hasPositionPrice(row) ? row.lastPrice.toFixed(3) : '--'}
                          <div className="mt-1 text-[11px] text-muted-text">{row.priceDate ?? '--'}</div>
                        </td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-foreground">{formatMoney(row.marketValueBase, row.valuationCurrency)}</td>
                        <td className={`px-3 py-3.5 text-right tabular-nums ${(row.unrealizedPnlBase ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                          <div>{formatMoney(row.unrealizedPnlBase, row.valuationCurrency)}</div>
                          <div className="mt-1 text-xs">{formatSignedPct(row.unrealizedPnlPct)}</div>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          <button
                            type="button"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cyan transition-colors hover:text-foreground"
                            onClick={() => void handleOpenDiagnosis(row)}
                          >
                            {text.viewDiagnosis}<ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card padding="md">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">{text.riskOverview}</h2>
              <ShieldAlert className="h-5 w-5 text-warning" />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {[
                { label: text.concentration, value: formatPct(risk?.concentration.topWeightPct), detail: topPosition?.symbol ?? '--', alert: Boolean(risk?.concentration.alert), icon: AlertTriangle },
                { label: text.currentDrawdown, value: formatPct(risk?.drawdown.currentDrawdownPct), detail: risk?.drawdown.alert ? text.riskTriggered : text.normal, alert: Boolean(risk?.drawdown.alert), icon: TrendingDown },
                { label: text.stopLoss, value: `${text.triggered} ${risk?.stopLoss.triggeredCount ?? '--'}`, detail: `${text.near} ${risk?.stopLoss.nearCount ?? '--'}`, alert: Boolean(risk?.stopLoss.nearAlert), icon: ShieldAlert },
                { label: text.financing, value: '--', detail: text.notRecorded, alert: false, icon: CircleDollarSign },
              ].map(({ label, value, detail, alert, icon: Icon }) => (
                <div key={label} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-surface/45 px-3.5 py-3">
                  <Icon className={`h-4 w-4 shrink-0 ${alert ? 'text-danger' : 'text-secondary-text'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-text">{label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
                  </div>
                  <span className="max-w-28 truncate text-right text-xs text-secondary-text">{detail}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="md">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-cyan" />
              <h2 className="text-base font-semibold text-foreground">{text.watchlist}</h2>
            </div>
            {watchItems.length ? (
              <ul className="mt-4 space-y-2">
                {watchItems.map((item) => (
                  <li key={item} className="flex gap-2 rounded-xl border border-warning/20 bg-warning/5 px-3 py-2.5 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 flex gap-2 rounded-xl border border-success/20 bg-success/5 px-3 py-3 text-sm text-success">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{text.noWatchItems}</span>
              </div>
            )}
          </Card>
        </div>
      </section>

      <Card padding="md">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-purple/25 bg-purple/10 p-2.5"><Sparkles className="h-5 w-5 text-purple" /></div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{text.latestReview}</h2>
              {latestReview ? (
                <p className="mt-1 text-xs text-secondary-text">
                  {latestReview.reviewDate} · {text.version} {latestReview.version} · {text.ruleReview}
                </p>
              ) : <p className="mt-1 text-xs text-secondary-text">{text.noReviewDescription}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {latestReview ? (
              <Button variant="secondary" size="sm" onClick={() => void handleVerify()} isLoading={verifying} loadingText={text.verifying}>
                <CheckCircle2 className="h-4 w-4" />{text.verify}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void handleCreateReview()} isLoading={creatingReview} loadingText={text.creatingReview}>
              <Sparkles className="h-4 w-4" />{text.createReview}
            </Button>
          </div>
        </div>

        {latestReview ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-border/60 bg-surface/45 p-4">
              <p className="text-xs text-muted-text">{text.netAssets}</p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {formatMoney(
                  typeof latestReview.payload?.facts === 'object' && latestReview.payload.facts !== null
                    ? Number((latestReview.payload.facts as Record<string, unknown>).totalEquity)
                    : undefined,
                  snapshot?.currency,
                )}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-surface/45 p-4">
              <p className="text-xs text-muted-text">{text.verification}</p>
              <div className="mt-2"><Badge variant={verificationVariant(latestVerification?.status)}>{verificationLabel(latestVerification?.status, language)}</Badge></div>
              <p className="mt-2 text-xs text-secondary-text">{latestVerification?.asOf ?? text.verificationEmpty}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/portfolio')}
              className="group flex items-center justify-between rounded-2xl border border-border/60 bg-surface/45 p-4 text-left transition-colors hover:bg-hover"
            >
              <div>
                <p className="text-xs text-muted-text">Markdown + JSON</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{text.manage}</p>
              </div>
              <ArrowRight className="h-5 w-5 text-secondary-text transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-secondary-text">{text.noReview}</div>
        )}
      </Card>

      <Drawer
        isOpen={selectedPosition !== null}
        onClose={() => {
          setSelectedPosition(null);
          setDiagnosis(null);
          setDiagnosisError(null);
        }}
        title={selectedPosition ? `${text.diagnosisTitle} · ${selectedPosition.symbol}` : text.diagnosisTitle}
        width="max-w-3xl"
      >
        {diagnosisLoading ? <Loading label={text.loadingDiagnosis} /> : null}
        {diagnosisError ? <ApiErrorAlert error={diagnosisError} /> : null}
        {diagnosis ? (() => {
          const status = diagnosisStatusView(diagnosis.status, text);
          const currency = selectedPosition?.valuationCurrency ?? snapshot?.currency ?? 'CNY';
          return (
            <div className="space-y-4" data-testid="portfolio-position-diagnosis">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
                <Badge variant="info">{text.deterministicRules}</Badge>
                <span className="text-xs text-secondary-text">{text.validDate}: {diagnosis.validDate}</span>
              </div>

              <section className="rounded-2xl border border-border/60 bg-surface/40 p-4">
                <h3 className="text-sm font-semibold text-foreground">{text.factsAndCalculations}</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[
                    [text.quantity, readNumber(diagnosis.facts, 'quantity')?.toLocaleString('zh-CN') ?? '--'],
                    [text.averageCost, formatMoney(readNumber(diagnosis.facts, 'avgCost'), currency)],
                    [text.price, formatMoney(readNumber(diagnosis.facts, 'lastPrice'), currency)],
                    [text.priceSource, `${readText(diagnosis.facts, 'priceProvider')} · ${readText(diagnosis.facts, 'priceDate')}`],
                    [text.value, formatMoney(readNumber(diagnosis.calculations, 'marketValue'), currency)],
                    [text.pnl, `${formatMoney(readNumber(diagnosis.calculations, 'unrealizedPnl'), currency)} · ${formatSignedPct(readNumber(diagnosis.calculations, 'unrealizedPnlPct'))}`],
                    [text.positionWeight, formatPct(readNumber(diagnosis.calculations, 'positionWeightPct'))],
                    [text.account, diagnosis.accountName || String(diagnosis.accountId)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-xs text-muted-text">{label}</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <EvidenceList title={text.supportingEvidence} items={diagnosis.supportingEvidence} emptyLabel={text.noEvidence} />
              <EvidenceList title={text.opposingEvidence} items={diagnosis.opposingEvidence} emptyLabel={text.noEvidence} />
              <EvidenceList title={text.riskTriggers} items={diagnosis.riskTriggers} emptyLabel={text.noEvidence} />
              <EvidenceList title={text.watchItems} items={diagnosis.watchItems} emptyLabel={text.noEvidence} />

              <section className="rounded-2xl border border-warning/20 bg-warning/5 p-4">
                <h3 className="text-sm font-semibold text-foreground">{text.missingData}</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {diagnosis.missingData.map((item) => (
                    <Badge key={item} variant="warning">{MISSING_DATA_LABELS[item]?.[language] ?? item}</Badge>
                  ))}
                </div>
              </section>
            </div>
          );
        })() : null}
      </Drawer>
    </div>
  );
};

export default PortfolioDashboardPage;
