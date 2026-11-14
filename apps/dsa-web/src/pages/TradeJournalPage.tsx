import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpenCheck, ClipboardCheck, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { portfolioApi } from '../api/portfolio';
import { Button, Card, EmptyState, InlineAlert, Loading } from '../components/common';
import { useUiLanguage } from '../contexts/UiLanguageContext';
import type {
  PortfolioAccountItem,
  PortfolioTradeJournalItem,
  PortfolioTradeJournalSummary,
} from '../types/portfolio';

type JournalForm = {
  symbol: string;
  journalDate: string;
  side: 'buy' | 'sell';
  reason: string;
  plannedTrade: boolean;
  emotionState: string;
  chasedPrice: boolean;
  planDeviation: string;
  postReview: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): JournalForm => ({
  symbol: '',
  journalDate: today(),
  side: 'buy',
  reason: '',
  plannedTrade: true,
  emotionState: '',
  chasedPrice: false,
  planDeviation: '',
  postReview: '',
});

const fieldClass = 'mt-1 w-full rounded-xl border border-border bg-base px-3 py-2 text-sm text-foreground outline-none transition focus:border-cyan/50 focus:ring-2 focus:ring-cyan/10';

const TradeJournalPage: React.FC = () => {
  const { language } = useUiLanguage();
  const zh = language === 'zh';
  const [accounts, setAccounts] = useState<PortfolioAccountItem[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const accountIdRef = useRef<number | null>(null);
  const [items, setItems] = useState<PortfolioTradeJournalItem[]>([]);
  const [summary, setSummary] = useState<PortfolioTradeJournalSummary | null>(null);
  const [form, setForm] = useState<JournalForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = useMemo(() => ({
    title: zh ? '交易日志与纪律分析' : 'Trade journal & discipline',
    description: zh ? '记录交易当时的计划、情绪与执行偏差，用确定性统计检查纪律。' : 'Capture plans, emotions, and execution deviations to review discipline with deterministic statistics.',
    newEntry: zh ? '新增日志' : 'New entry',
    history: zh ? '日志记录' : 'Journal history',
    total: zh ? '记录总数' : 'Total entries',
    planned: zh ? '计划内交易' : 'Planned trades',
    unplanned: zh ? '计划外交易' : 'Unplanned trades',
    chased: zh ? '追高记录' : 'Chased-price entries',
    account: zh ? '证券账户' : 'Account',
    symbol: zh ? '股票代码' : 'Symbol',
    date: zh ? '交易日期' : 'Trade date',
    side: zh ? '方向' : 'Side',
    buy: zh ? '买入' : 'Buy',
    sell: zh ? '卖出' : 'Sell',
    reason: zh ? '买卖理由' : 'Trade rationale',
    emotion: zh ? '情绪状态' : 'Emotion state',
    plannedTrade: zh ? '这是计划内交易' : 'This trade was planned',
    chasedPrice: zh ? '发生追高' : 'Chased price',
    deviation: zh ? '与原计划的偏差' : 'Deviation from plan',
    review: zh ? '事后复盘' : 'Post-trade review',
    save: zh ? '保存日志' : 'Save entry',
    saving: zh ? '正在保存' : 'Saving',
    refresh: zh ? '刷新' : 'Refresh',
    empty: zh ? '暂无交易日志' : 'No journal entries yet',
    emptyDescription: zh ? '先记录一笔交易决策，系统才会开始统计纪律表现。' : 'Record a trade decision to start discipline tracking.',
    sampleTitle: zh ? '样本量提示' : 'Sample-size notice',
    sampleMessage: zh ? '当前样本少于 20 条，统计仅用于描述行为，不能解释为稳定交易规律。' : 'Fewer than 20 samples are descriptive only and do not establish a stable trading pattern.',
    unavailable: zh ? '胜率、盈亏比和最大回撤需完整平仓配对与收益数据，本阶段不生成推测值。' : 'Win rate, profit/loss ratio, and drawdown require paired closed trades and are not inferred here.',
    delete: zh ? '删除日志' : 'Delete entry',
  }), [zh]);

  const loadJournals = useCallback(async (selectedAccountId: number) => {
    const response = await portfolioApi.listTradeJournals(selectedAccountId);
    setItems(response.items);
    setSummary(response.summary);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accountResponse = await portfolioApi.getAccounts();
      setAccounts(accountResponse.accounts);
      const selected = accountIdRef.current ?? accountResponse.accounts[0]?.id ?? null;
      setAccountId(selected);
      accountIdRef.current = selected;
      if (selected != null) {
        await loadJournals(selected);
      } else {
        setItems([]);
        setSummary(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [loadJournals]);

  useEffect(() => {
    document.title = `${copy.title} - DSA`;
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [copy.title, load]);

  const changeAccount = async (nextId: number) => {
    setAccountId(nextId);
    accountIdRef.current = nextId;
    setLoading(true);
    setError(null);
    try {
      await loadJournals(nextId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (accountId == null || !form.symbol.trim() || !form.reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await portfolioApi.createTradeJournal({
        accountId,
        symbol: form.symbol.trim(),
        journalDate: form.journalDate,
        side: form.side,
        reason: form.reason.trim(),
        plannedTrade: form.plannedTrade,
        emotionState: form.emotionState.trim() || null,
        chasedPrice: form.chasedPrice,
        planDeviation: form.planDeviation.trim() || null,
        postReview: form.postReview.trim() || null,
      });
      setForm(emptyForm());
      await loadJournals(accountId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (journalId: number) => {
    if (accountId == null) return;
    setError(null);
    try {
      await portfolioApi.deleteTradeJournal(journalId);
      await loadJournals(accountId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-cyan"><BookOpenCheck className="h-5 w-5" /><span className="label-uppercase">Portfolio Copilot</span></div>
          <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary-text">{copy.description}</p>
        </div>
        <Button variant="secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{copy.refresh}</Button>
      </header>

      {error ? <InlineAlert variant="danger" title={zh ? '操作失败' : 'Operation failed'} message={error} /> : null}
      {summary && !summary.sampleSufficient ? <InlineAlert variant="warning" title={copy.sampleTitle} message={copy.sampleMessage} /> : null}
      <InlineAlert variant="info" message={copy.unavailable} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [copy.total, summary?.total ?? 0, ClipboardCheck],
          [copy.planned, summary?.plannedCount ?? 0, BookOpenCheck],
          [copy.unplanned, summary?.unplannedCount ?? 0, AlertTriangle],
          [copy.chased, summary?.chasedCount ?? 0, AlertTriangle],
        ].map(([label, value, Icon]) => (
          <Card key={String(label)} padding="sm"><div className="flex items-center justify-between"><div><p className="text-xs text-secondary-text">{String(label)}</p><p className="mt-2 text-2xl font-semibold text-foreground">{String(value)}</p></div><Icon className="h-5 w-5 text-cyan" /></div></Card>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <Card title={copy.newEntry}>
          <form className="grid gap-4" onSubmit={submit}>
            <label className="text-sm text-secondary-text">{copy.account}<select className={fieldClass} value={accountId ?? ''} onChange={(event) => void changeAccount(Number(event.target.value))} disabled={!accounts.length}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-secondary-text">{copy.symbol}<input className={fieldClass} value={form.symbol} onChange={(event) => setForm((current) => ({ ...current, symbol: event.target.value }))} placeholder="600519" required /></label>
              <label className="text-sm text-secondary-text">{copy.date}<input className={fieldClass} type="date" value={form.journalDate} onChange={(event) => setForm((current) => ({ ...current, journalDate: event.target.value }))} required /></label>
            </div>
            <label className="text-sm text-secondary-text">{copy.side}<select className={fieldClass} value={form.side} onChange={(event) => setForm((current) => ({ ...current, side: event.target.value as 'buy' | 'sell' }))}><option value="buy">{copy.buy}</option><option value="sell">{copy.sell}</option></select></label>
            <label className="text-sm text-secondary-text">{copy.reason}<textarea className={fieldClass} rows={3} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} required /></label>
            <label className="text-sm text-secondary-text">{copy.emotion}<input className={fieldClass} value={form.emotionState} onChange={(event) => setForm((current) => ({ ...current, emotionState: event.target.value }))} placeholder={zh ? '例如：冷静、焦虑、兴奋' : 'e.g. calm, anxious, excited'} /></label>
            <div className="flex flex-wrap gap-5 text-sm text-foreground"><label className="flex items-center gap-2"><input type="checkbox" checked={form.plannedTrade} onChange={(event) => setForm((current) => ({ ...current, plannedTrade: event.target.checked }))} />{copy.plannedTrade}</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.chasedPrice} onChange={(event) => setForm((current) => ({ ...current, chasedPrice: event.target.checked }))} />{copy.chasedPrice}</label></div>
            <label className="text-sm text-secondary-text">{copy.deviation}<textarea className={fieldClass} rows={2} value={form.planDeviation} onChange={(event) => setForm((current) => ({ ...current, planDeviation: event.target.value }))} /></label>
            <label className="text-sm text-secondary-text">{copy.review}<textarea className={fieldClass} rows={2} value={form.postReview} onChange={(event) => setForm((current) => ({ ...current, postReview: event.target.value }))} /></label>
            <Button type="submit" isLoading={saving} loadingText={copy.saving} disabled={accountId == null || !form.symbol.trim() || !form.reason.trim()}><Plus className="h-4 w-4" />{copy.save}</Button>
          </form>
        </Card>

        <Card title={copy.history}>
          {loading ? <Loading /> : items.length === 0 ? <EmptyState title={copy.empty} description={copy.emptyDescription} /> : (
            <div className="space-y-3">{items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-border/70 bg-base/40 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><div className="flex flex-wrap items-center gap-2"><span className="text-lg font-semibold text-foreground">{item.symbol}</span><span className={item.side === 'buy' ? 'text-success' : 'text-danger'}>{item.side === 'buy' ? copy.buy : copy.sell}</span><span className="rounded-full border border-border px-2 py-0.5 text-xs text-secondary-text">{item.plannedTrade ? copy.planned : copy.unplanned}</span>{item.chasedPrice ? <span className="rounded-full border border-warning/40 px-2 py-0.5 text-xs text-warning">{copy.chasedPrice}</span> : null}</div><p className="mt-1 text-xs text-secondary-text">{item.journalDate}{item.emotionState ? ` · ${item.emotionState}` : ''}</p></div>
                  <Button variant="ghost" size="sm" aria-label={`${copy.delete} ${item.symbol}`} onClick={() => void remove(item.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <p className="mt-3 text-sm text-foreground">{item.reason}</p>
                {item.planDeviation ? <p className="mt-2 text-xs text-warning">{copy.deviation}：{item.planDeviation}</p> : null}
                {item.postReview ? <p className="mt-2 text-xs text-secondary-text">{copy.review}：{item.postReview}</p> : null}
              </article>
            ))}</div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default TradeJournalPage;
