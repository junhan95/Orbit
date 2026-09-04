'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, Cpu, Globe, LoaderCircle, MessageSquareText, Send } from 'lucide-react';

/**
 * 시리즈 색은 앱 브랜드 팔레트에서 고른 뒤 dataviz 검증기로 확인한 값입니다.
 * (light / surface #fff — 명도대역·채도·CVD 분리 PASS, 최악 인접쌍 ΔE 29.8 protan)
 * 대비 경고가 있는 주황 계열은 아래 일별 표(표 뷰)가 완화 채널 역할을 합니다.
 */
const SERIES_INPUT = '#6651f2';
const SERIES_OUTPUT = '#ff7557';
const RANGES = [7, 30, 90] as const;

type Bucket = {
  requests: number; inputTokens: number; outputTokens: number;
  cacheCreationTokens: number; cacheReadTokens: number; webSearchRequests: number; costUsd: number;
};
type DailyPoint = Bucket & { date: string };
type UsageData = {
  rangeDays: number;
  totals: Bucket;
  daily: DailyPoint[];
  byKind: (Bucket & { kind: string; label: string })[];
  byModel: (Bucket & { model: string; priceKnown: boolean })[];
  byAgent: (Bucket & { agentName: string })[];
  pricing: { webSearchPerCall: number; models: { model: string; input: number; output: number; cacheWrite: number; cacheRead: number }[] };
};

function formatUsd(value: number) {
  if (!value) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number) {
  if (value < 1000) return `${value}`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

function formatDay(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** 축 눈금을 1/2/5 배수의 깔끔한 값으로 올림합니다. */
function niceCeil(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function UsageView({ onNotice }: { onNotice: (message: string) => void }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [days, setDays] = useState<number>(30);
  const [metric, setMetric] = useState<'cost' | 'tokens'>('cost');
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    try {
      const tz = new Date().getTimezoneOffset();
      const response = await fetch(`/api/usage?days=${range}&tz=${tz}`);
      if (!response.ok) throw new Error('사용량을 불러오지 못했습니다.');
      setData(await response.json() as UsageData);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '사용량을 불러오지 못했습니다.');
    } finally { setLoading(false); }
  }, [onNotice]);

  // oxlint-disable-next-line react/react-compiler -- 기간이 바뀔 때마다 서버에서 다시 집계해 옵니다
  useEffect(() => { void load(days); }, [days, load]);

  const daily = useMemo(() => data?.daily ?? [], [data]);
  const axisMax = useMemo(() => niceCeil(Math.max(
    ...daily.map((point) => metric === 'cost' ? point.costUsd : point.inputTokens + point.outputTokens),
    metric === 'cost' ? 0.01 : 1,
  )), [daily, metric]);

  const totals = data?.totals;
  const totalTokens = totals ? totals.inputTokens + totals.outputTokens : 0;
  const labelEvery = Math.max(1, Math.ceil(daily.length / 8));

  return (
    <div className="workspace-view">
      <div className="workspace-heading">
        <div>
          <span className="section-kicker">AI Usage</span>
          <h1>AI 사용량</h1>
          <p>Claude 호출로 소비한 토큰과 웹 검색, 그리고 공개 단가 기준 비용 추정입니다.</p>
        </div>
        <fieldset className="view-switch" aria-label="조회 기간">
          {RANGES.map((range) => (
            <button className={days === range ? 'selected' : ''} key={range} onClick={() => setDays(range)}>{range}일</button>
          ))}
        </fieldset>
      </div>

      {loading && !data ? <div className="view-loading"><LoaderCircle className="spin" /><span>사용량을 집계하는 중</span></div> : <>
        <section className="usage-kpis" aria-label="사용량 요약">
          <article className="stat-card usage-kpi">
            <span className="icon-tile violet"><Coins size={18} /></span>
            <div><strong>{formatUsd(totals?.costUsd ?? 0)}</strong><span>비용 추정</span></div>
            <em>최근 {data?.rangeDays ?? days}일 · 공개 단가 기준</em>
          </article>
          <article className="stat-card usage-kpi">
            <span className="icon-tile blue"><Send size={18} /></span>
            <div><strong>{totals?.requests ?? 0}</strong><span>API 요청</span></div>
            <em>실행 + 대화 합계</em>
          </article>
          <article className="stat-card usage-kpi">
            <span className="icon-tile mint"><Cpu size={18} /></span>
            <div><strong>{formatTokens(totalTokens)}</strong><span>총 토큰</span></div>
            <em>입력 {formatTokens(totals?.inputTokens ?? 0)} · 출력 {formatTokens(totals?.outputTokens ?? 0)}</em>
          </article>
          <article className="stat-card usage-kpi">
            <span className="icon-tile orange"><Globe size={18} /></span>
            <div><strong>{totals?.webSearchRequests ?? 0}</strong><span>웹 검색</span></div>
            <em>1,000회당 ${((data?.pricing.webSearchPerCall ?? 0.01) * 1000).toFixed(0)}</em>
          </article>
        </section>

        <section className="usage-chart-card">
          <div className="section-header">
            <div>
              <span className="section-kicker">추이</span>
              <h2>{metric === 'cost' ? '일별 비용 추정' : '일별 토큰 사용량'}</h2>
            </div>
            <fieldset className="view-switch small" aria-label="표시 지표">
              <button className={metric === 'cost' ? 'selected' : ''} onClick={() => setMetric('cost')}>비용</button>
              <button className={metric === 'tokens' ? 'selected' : ''} onClick={() => setMetric('tokens')}>토큰</button>
            </fieldset>
          </div>

          {metric === 'tokens' && (
            <div className="usage-legend">
              <span><i style={{ background: SERIES_INPUT }} /> 입력 토큰</span>
              <span><i style={{ background: SERIES_OUTPUT }} /> 출력 토큰</span>
            </div>
          )}

          <div className="usage-plot">
            <div className="usage-axis" aria-hidden="true">
              {[1, 0.5, 0].map((ratio) => (
                <div className="usage-axis-row" key={ratio} style={{ bottom: `${ratio * 100}%` }}>
                  <span>{metric === 'cost' ? formatUsd(axisMax * ratio) : formatTokens(Math.round(axisMax * ratio))}</span>
                  <i />
                </div>
              ))}
            </div>
            <div className="usage-columns" onMouseLeave={() => setHovered(null)}>
              {daily.map((point, index) => {
                const value = metric === 'cost' ? point.costUsd : point.inputTokens + point.outputTokens;
                const inputHeight = metric === 'tokens' ? (point.inputTokens / axisMax) * 100 : 0;
                const outputHeight = metric === 'tokens' ? (point.outputTokens / axisMax) * 100 : 0;
                return (
                  <button
                    className={hovered === index ? 'usage-column hovered' : 'usage-column'}
                    key={point.date}
                    type="button"
                    onMouseEnter={() => setHovered(index)}
                    onFocus={() => setHovered(index)}
                    onBlur={() => setHovered(null)}
                    aria-label={`${point.date} · 요청 ${point.requests}건 · ${formatTokens(point.inputTokens + point.outputTokens)} 토큰 · ${formatUsd(point.costUsd)}`}
                  >
                    <span className="usage-stack">
                      {metric === 'cost'
                        ? value > 0 && <i className="usage-bar" style={{ height: `${(value / axisMax) * 100}%`, background: SERIES_INPUT }} />
                        : <>
                            {point.outputTokens > 0 && <i className="usage-bar" style={{ height: `${outputHeight}%`, background: SERIES_OUTPUT }} />}
                            {point.inputTokens > 0 && <i className="usage-bar" style={{ height: `${inputHeight}%`, background: SERIES_INPUT }} />}
                          </>}
                    </span>
                    <em>{index % labelEvery === 0 || index === daily.length - 1 ? formatDay(point.date) : ''}</em>
                  </button>
                );
              })}
            </div>
            {hovered !== null && daily[hovered] && (() => {
              // 툴팁이 플롯 밖으로 나가 잘리지 않도록 양끝에서는 정렬을 바꿉니다.
              const left = ((hovered + 0.5) / daily.length) * 100;
              const align = left < 16 ? 'start' : left > 84 ? 'end' : 'center';
              return (
              <div className={`usage-tooltip ${align}`} style={{ left: `${left}%` }}>
                <strong>{daily[hovered].date}</strong>
                <span><i style={{ background: SERIES_INPUT }} /> 입력 <b>{formatTokens(daily[hovered].inputTokens)}</b></span>
                <span><i style={{ background: SERIES_OUTPUT }} /> 출력 <b>{formatTokens(daily[hovered].outputTokens)}</b></span>
                <span className="usage-tooltip-foot">요청 <b>{daily[hovered].requests}</b> · 검색 <b>{daily[hovered].webSearchRequests}</b> · <b>{formatUsd(daily[hovered].costUsd)}</b></span>
              </div>
              );
            })()}
          </div>
        </section>

        <section className="usage-split">
          <Breakdown
            kicker="기능별" title="어디에 썼나"
            rows={(data?.byKind ?? []).map((row) => ({ key: row.kind, label: row.label, cost: row.costUsd, requests: row.requests, tokens: row.inputTokens + row.outputTokens }))}
            icon={<MessageSquareText size={16} />}
          />
          <Breakdown
            kicker="에이전트별" title="누가 썼나"
            rows={(data?.byAgent ?? []).map((row) => ({ key: row.agentName, label: row.agentName, cost: row.costUsd, requests: row.requests, tokens: row.inputTokens + row.outputTokens }))}
            icon={<Cpu size={16} />}
          />
        </section>

        <section className="usage-table-card">
          <div className="section-header"><div><span className="section-kicker">상세</span><h2>일별 내역</h2></div></div>
          <div className="usage-table-scroll">
            <table className="usage-table">
              <thead><tr><th>날짜</th><th>요청</th><th>입력</th><th>출력</th><th>캐시 읽기</th><th>검색</th><th>비용 추정</th></tr></thead>
              <tbody>
                {daily.filter((point) => point.requests > 0).reverse().map((point) => (
                  <tr key={point.date}>
                    <td>{point.date}</td>
                    <td>{point.requests}</td>
                    <td>{point.inputTokens.toLocaleString()}</td>
                    <td>{point.outputTokens.toLocaleString()}</td>
                    <td>{point.cacheReadTokens.toLocaleString()}</td>
                    <td>{point.webSearchRequests}</td>
                    <td>{formatUsd(point.costUsd)}</td>
                  </tr>
                ))}
                {!daily.some((point) => point.requests > 0) && (
                  <tr><td colSpan={7} className="usage-empty">이 기간에 기록된 Claude 호출이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="usage-table-card">
          <div className="section-header"><div><span className="section-kicker">모델</span><h2>모델별 사용량과 적용 단가</h2></div></div>
          <div className="usage-table-scroll">
            <table className="usage-table">
              <thead><tr><th>모델</th><th>요청</th><th>입력</th><th>출력</th><th>입력 단가</th><th>출력 단가</th><th>비용 추정</th></tr></thead>
              <tbody>
                {(data?.byModel ?? []).map((row) => {
                  const price = data?.pricing.models.find((item) => row.model.startsWith(item.model));
                  return (
                    <tr key={row.model}>
                      <td>{row.model}{!row.priceKnown && <em className="usage-warn"> 단가 미등록</em>}</td>
                      <td>{row.requests}</td>
                      <td>{row.inputTokens.toLocaleString()}</td>
                      <td>{row.outputTokens.toLocaleString()}</td>
                      <td>{price ? `$${price.input}` : '—'}</td>
                      <td>{price ? `$${price.output}` : '—'}</td>
                      <td>{formatUsd(row.costUsd)}</td>
                    </tr>
                  );
                })}
                {!(data?.byModel ?? []).length && <tr><td colSpan={7} className="usage-empty">아직 기록이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="usage-note">
            단가는 <code>lib/pricing.ts</code>에 상수로 적혀 있는 Anthropic 공개 가격(100만 토큰 기준)입니다.
            프롬프트 캐시·웹 검색까지 반영한 <strong>추정치</strong>이므로 실제 청구액과 다를 수 있고,
            단가가 바뀌면 그 파일만 고치면 됩니다. 단가가 등록되지 않은 모델은 Sonnet 5 기준으로 계산합니다.
          </p>
        </section>
      </>}
    </div>
  );
}

function Breakdown({ kicker, title, rows, icon }: {
  kicker: string; title: string; icon: React.ReactNode;
  rows: { key: string; label: string; cost: number; requests: number; tokens: number }[];
}) {
  const max = Math.max(...rows.map((row) => row.cost), 0.000001);
  return (
    <article className="usage-breakdown">
      <div className="section-header"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div>{icon}</div>
      {rows.length ? <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <div className="usage-breakdown-top"><strong>{row.label}</strong><span>{formatUsd(row.cost)}</span></div>
            <div className="usage-breakdown-track"><i style={{ width: `${Math.max(2, (row.cost / max) * 100)}%`, background: SERIES_INPUT }} /></div>
            <small>요청 {row.requests}건 · {formatTokens(row.tokens)} 토큰</small>
          </li>
        ))}
      </ul> : <div className="usage-empty">아직 기록이 없습니다.</div>}
    </article>
  );
}
