'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const COLORS = ['#6366F1', '#22C55E', '#F59E0B', '#06B6D4', '#A855F7', '#84CC16', '#F97316']
const fmt2 = (v: any) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '0.00')

// 로컬 타임존 기준 datetime-local 값 생성
const toISOStringLocal = (date: Date) => {
  const tzOffset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16)
}

export default function Dashboard() {
  // 기본 기간: 한 달 전 ~ 지금
  const now = new Date()
  const oneMonthAgo = new Date(now)
  oneMonthAgo.setMonth(now.getMonth() - 1)

  const [from, setFrom] = useState<string>(toISOStringLocal(oneMonthAgo))
  const [to, setTo] = useState<string>(toISOStringLocal(now))
  const [user, setUser] = useState<string>('') // 선택된 사용자(이메일)

  // 쿼리스트링 구성
  const qs = useMemo(() => {
    const p = new URLSearchParams({ from, to })
    if (user) p.set('user', user)
    return p.toString()
  }, [from, to, user])

  const { data } = useSWR(() => `/api/events?${qs}`, fetcher)

  // API가 항상 users(이메일 목록)를 돌려줌
  const users: string[] = data?.users ?? []

  // user 미선택 시 최초 옵션 자동 선택
  useEffect(() => {
    if (!user && users.length > 0) setUser(users[0])
  }, [users, user])

  const asisSummary: any[] = data?.asisSummary ?? []
  const tobeSummary: any[] = data?.tobeSummary ?? []
  const phaseSummary: any[] = data?.phaseSummary ?? []

  // KPI
  const kpis = useMemo(() => {
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length)
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

    const asisAvgTotal = avg(asisSummary.map((s: any) => Number(s.totalMin ?? 0) || 0))
    const tobeAvgTotal = avg(tobeSummary.map((s: any) => Number(s.totalMin ?? 0) || 0))

    const asisBack = sum(asisSummary.map((s: any) => Number(s.backtracks ?? 0) || 0))
    const tobeBack = sum(tobeSummary.map((s: any) => Number(s.backtracks ?? 0) || 0))

    if (asisSummary.length + tobeSummary.length === 0) return null
    return { asisAvgTotal, tobeAvgTotal, asisBack, tobeBack }
  }, [asisSummary, tobeSummary])

  // 단계별 평균 소요시간(분) 막대
  const stepBar = useMemo(() => {
    const stepSet = new Set<string>()
    const fold = (summary: any[] = []) => {
      const acc: Record<string, { sum: number; n: number }> = {}
      summary.forEach((s) => {
        Object.entries(s.stepAvgSec ?? {}).forEach(([step, sec]: any) => {
          stepSet.add(step)
          acc[step] ??= { sum: 0, n: 0 }
          acc[step].sum += Number(sec) || 0
          acc[step].n += 1
        })
      })
      return Object.fromEntries(
        Object.entries(acc).map(([k, v]) => [k, v.sum / Math.max(1, v.n) / 60]) // 분
      )
    }
    const asis = fold(asisSummary)
    const tobe = fold(tobeSummary)
    return [...stepSet].map((step) => ({
      step,
      asis: asis[step] ?? 0,
      tobe: tobe[step] ?? 0,
    }))
  }, [asisSummary, tobeSummary])

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">사용자 테스트 대시보드 (As-Is vs To-Be)</h1>

      {/* 사용자 + 날짜 선택(상단 필터) */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm">User</label>
          <select
            className="border p-2 rounded min-w-[240px]"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          >
            {users.length === 0 && <option value="">(사용자 없음)</option>}
            {users.map((email: string) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm">From</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
        <div>
          <label className="block text-sm">To</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
      </div>

      {/* KPI */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi title="평균 총 소요시간 (분) — As-Is" value={fmt2(kpis.asisAvgTotal)} />
          <Kpi title="평균 총 소요시간 (분) — To-Be" value={fmt2(kpis.tobeAvgTotal)} />
          <Kpi title="되돌림 횟수 — As-Is" value={fmt2(kpis.asisBack)} />
          <Kpi title="되돌림 횟수 — To-Be" value={fmt2(kpis.tobeBack)} />
        </div>
      )}

      {/* Phase Summary 카드 */}
      {phaseSummary.length ? (
        <section>
          <h2 className="text-xl font-semibold mb-2">페이즈 요약 (평균 소요시간, 분)</h2>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
          >
            {phaseSummary.map((p: any) => {
              const asisMin = Number(p.asisMin ?? 0) || 0
              const tobeMin = Number(p.tobeMin ?? 0) || 0
              const delta = tobeMin - asisMin
              const improve = delta <= 0
              return (
                <div key={p.phase} className="p-4 border rounded-xl text-sm">
                  <div className="text-gray-700 font-semibold mb-1">{p.phase}</div>
                  <div>
                    As-Is: <b>{fmt2(asisMin)}</b>
                  </div>
                  <div>
                    To-Be: <b>{fmt2(tobeMin)}</b>
                  </div>
                  <div className={`mt-1 ${improve ? 'text-emerald-600' : 'text-amber-600'}`}>
                    Δ: {improve ? '−' : '+'}
                    {fmt2(Math.abs(delta))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* 단계별 평균 소요시간(분) */}
      <section>
        <h2 className="text-xl font-semibold mb-2">단계별 평균 소요시간(분)</h2>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={stepBar}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="step" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="asis" name="asis" fill={COLORS[1]}>
                {stepBar.map((_, i) => (
                  <Cell key={`asis-${i}`} fill={COLORS[1]} />
                ))}
              </Bar>
              <Bar dataKey="tobe" name="tobe" fill={COLORS[2]}>
                {stepBar.map((_, i) => (
                  <Cell key={`tobe-${i}`} fill={COLORS[2]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="p-4 border rounded-xl">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}
