import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/** Step → Phase 매핑 (필요 시 확장) */
const PHASE_MAP: Record<string, string> = {
  LOGIN: 'Preparation',
  EBOM: 'Preparation',
  'LCA TARGET': 'Preparation',
  CATIA: 'Design',
  REVIEW: 'Verification',
  'CHECK List': 'Verification',
  'STAGE Change': 'Stage/Finish',
  'PROCESS END': 'Stage/Finish',
}
const mapStepToPhase = (step?: string | null) => PHASE_MAP[step ?? ''] ?? 'Other'

function getClient(kind: 'asis' | 'tobe') {
  const url =
    kind === 'asis' ? process.env.NEXT_PUBLIC_SUPABASE_ASIS_URL : process.env.NEXT_PUBLIC_SUPABASE_TOBE_URL
  const key =
    kind === 'asis'
      ? process.env.NEXT_PUBLIC_SUPABASE_ASIS_ANON_KEY
      : process.env.NEXT_PUBLIC_SUPABASE_TOBE_ANON_KEY
  if (!url) throw new Error(`supabase url missing for ${kind}`)
  if (!key) throw new Error(`supabase key missing for ${kind}`)
  return createClient(url, key, { db: { schema: 'app' } })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const user = searchParams.get('user') // 이메일 (옵션)

    const p_from = from ? new Date(from).toISOString() : null
    const p_to = to ? new Date(to).toISOString() : null
    const p_user = user || null

    const asis = getClient('asis')
    const tobe = getClient('tobe')

    // 공용 RPC: app.get_usage_events(p_from, p_to, p_user)
    const [asisRes, tobeRes] = await Promise.all([
      asis.rpc('get_usage_events', { p_from, p_to, p_user }),
      tobe.rpc('get_usage_events', { p_from, p_to, p_user }),
    ])

    if (asisRes.error) throw new Error(`As-Is RPC error: ${asisRes.error.message}`)
    if (tobeRes.error) throw new Error(`To-Be RPC error: ${tobeRes.error.message}`)

    type Row = {
      user_email: string
      step: string | null
      action: string | null
      detail: string | null
      created_at: string
      next_created_at: string | null
      duration_seconds_to_next: number | null
      prev_step: string | null
      next_step: string | null
    }

    const rowsAsIs: Row[] = (asisRes.data ?? []) as Row[]
    const rowsToBe: Row[] = (tobeRes.data ?? []) as Row[]

    // 사용자 목록 (하단 목록 대체 → 상단 드롭다운에 사용)
    const users = Array.from(
      new Set([
        ...rowsAsIs.map((r) => r.user_email).filter(Boolean),
        ...rowsToBe.map((r) => r.user_email).filter(Boolean),
      ])
    ).sort()



    // 요약 도우미
    const buildUserSummary = (rows: Row[]) => {
      // 시간순 정렬
      const list = [...rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      const totalSec = list.reduce((acc, r) => acc + (r.duration_seconds_to_next ?? 0), 0)
      // SQL (seen_before > 0)와 동일한 의미:
      // 같은 step이 이미 한 번이라도 등장했다면 1로 카운트
      const seenByStep = new Map<string, number>();
      let backtracks = 0;
      for (const r of list) {
        const stepKey = (r.step ?? 'Other').toString();
        const seen = seenByStep.get(stepKey) ?? 0;
        if (seen > 0) backtracks += 1;   // 재등장 → backtrack +1
        seenByStep.set(stepKey, seen + 1);
      }
      const stepBuckets: Record<string, { sum: number; n: number }> = {}
      list.forEach((r) => {
        const key = r.step ?? 'Other'
        stepBuckets[key] ??= { sum: 0, n: 0 }
        stepBuckets[key].sum += r.duration_seconds_to_next ?? 0
        stepBuckets[key].n += 1
      })
      const stepAvgSec: Record<string, number> = Object.fromEntries(
        Object.entries(stepBuckets).map(([k, v]) => [k, v.sum / Math.max(1, v.n)])
      )
      return {
        email: list[0]?.user_email ?? 'unknown',
        totalMin: totalSec / 60,
        backtracks,
        stepAvgSec,
      }
    }

    const summarizeByUser = (rows: Row[]) => {
      const byUser = new Map<string, Row[]>()
      rows.forEach((r) => {
        const key = r.user_email ?? 'unknown'
          ; (byUser.get(key)?.push(r)) ?? byUser.set(key, [r])
      })
      return Array.from(byUser.values()).map((list) => buildUserSummary(list))
    }

    // 사용자 지정이 들어오면 해당 사용자만 필터링
    const filterByUser = (rows: Row[]) => (p_user ? rows.filter((r) => r.user_email === p_user) : rows)

    const asisFiltered = filterByUser(rowsAsIs)
    const tobeFiltered = filterByUser(rowsToBe)

    const asisSummary = summarizeByUser(asisFiltered)
    const tobeSummary = summarizeByUser(tobeFiltered)

    // 페이즈 요약 (As-Is / To-Be 각각 합을 계산)
    const phaseAgg: Record<string, { asis: number; tobe: number }> = {}
    asisFiltered.forEach((r) => {
      const phase = mapStepToPhase(r.step)
      phaseAgg[phase] ??= { asis: 0, tobe: 0 }
      phaseAgg[phase].asis += (r.duration_seconds_to_next ?? 0) / 60
    })
    tobeFiltered.forEach((r) => {
      const phase = mapStepToPhase(r.step)
      phaseAgg[phase] ??= { asis: 0, tobe: 0 }
      phaseAgg[phase].tobe += (r.duration_seconds_to_next ?? 0) / 60
    })
    const phaseSummary = Object.entries(phaseAgg).map(([phase, v]) => ({
      phase,
      asisMin: v.asis,
      tobeMin: v.tobe,
    }))

    // 타임라인 (프런트의 호환성을 위해 As-Is를 기본으로 유지)
    const timelinesAsIs = asisFiltered.map((r) => ({
      email: r.user_email,
      step: r.step,
      action: r.action,
      detail: r.detail,
      at: r.created_at,
      nextAt: r.next_created_at,
      durationMin: (r.duration_seconds_to_next ?? 0) / 60,
    }))

    const timelinesToBe = tobeFiltered.map((r) => ({
      email: r.user_email,
      step: r.step,
      action: r.action,
      detail: r.detail,
      at: r.created_at,
      nextAt: r.next_created_at,
      durationMin: (r.duration_seconds_to_next ?? 0) / 60,
    }))

    return NextResponse.json({
      users,
      asisSummary,
      tobeSummary,
      phaseSummary,
      timelines: timelinesAsIs,
      timelinesAsIs,
      timelinesToBe,
    })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 })
  }
}
