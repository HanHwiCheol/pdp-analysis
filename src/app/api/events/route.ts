// app/api/events/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/** ====== 타입 ====== */
type Row = {
  user_email: string | null;
  treetable_id: string | null;
  step: string | null;
  action: string | null;
  detail: any;
  created_at: string;
  next_created_at: string | null;
  duration_seconds_to_next: number | null;
  prev_step: string | null;
  next_step: string | null;
};

/** ====== Step → Phase 매핑 ====== */
const PHASE_MAP: Record<string, string> = {
  LOGIN: 'Preparation',
  EBOM: 'Preparation',
  'LCA TARGET': 'Preparation',
  CATIA: 'Design',
  REVIEW: 'Verification',
  'CHECK List': 'Verification',
  'STAGE Change': 'Stage/Finish',
  'PROCESS END': 'Stage/Finish',
};
const PHASES = ['Preparation', 'Design', 'Integration', 'Verification', 'Stage/Finish', 'Other'] as const;

const toNum = (v: any, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const phaseOf = (step?: string | null, action?: string | null) => {
  const s = (step ?? '').trim();
  if (s in PHASE_MAP) return PHASE_MAP[s as keyof typeof PHASE_MAP];
  // Import 같은 키워드가 step/action에 있으면 Integration으로 분류
  const a = (action ?? '').toLowerCase();
  if (s.toLowerCase().includes('import') || a.includes('import')) return 'Integration';
  return 'Other';
};

/** ====== Supabase 클라이언트 (As-Is / To-Be) ====== */
function getClient(kind: 'asis' | 'tobe') {
  const url =
    kind === 'asis' ? process.env.NEXT_PUBLIC_SUPABASE_ASIS_URL : process.env.NEXT_PUBLIC_SUPABASE_TOBE_URL;
  const key =
    kind === 'asis' ? process.env.NEXT_PUBLIC_SUPABASE_ASIS_ANON_KEY : process.env.NEXT_PUBLIC_SUPABASE_TOBE_ANON_KEY;
  if (!url) throw new Error(`supabase url missing for ${kind}`);
  if (!key) throw new Error(`supabase key missing for ${kind}`);
  return createClient(url, key, { db: { schema: 'app' } });
}

/** ====== 되돌림(action 재방문) 계산 ====== */
// action 문자열 정규화
const normAction = (a?: string | null) => (a ?? '').trim().toLowerCase();

/** 같은 사용자 시퀀스에서 "동일 action"을 다시 수행한 횟수
 *  (연속 중복 로그는 노이즈로 간주하고 제외)
 *  rows: 반드시 같은 user, created_at 오름차순이어야 함
 */
function countRevisitsByActionNonConsecutive(rows: Row[]): number {
  const seen = new Set<string>();
  let cnt = 0;
  let prev = '';

  for (const r of rows) {
    const a = normAction(r.action);
    if (!a) continue;

    // 직전 이벤트와 동일 action이면 스킵 (연속 중복 제거)
    if (a === prev) continue;

    if (seen.has(a)) cnt += 1; // 이전에 등장했던 action을 다시 수행 → 재방문
    seen.add(a);
    prev = a;
  }
  return cnt;
}

/** ====== 사용자 요약 ====== */
function buildUserSummary(rows: Row[]) {
  const byStep: Record<string, { sum: number; n: number }> = {};
  let totalSec = 0;

  rows.forEach((r) => {
    const s = toNum(r.duration_seconds_to_next);
    totalSec += s;
    const step = r.step ?? 'Unknown';
    byStep[step] ??= { sum: 0, n: 0 };
    byStep[step].sum += s;
    byStep[step].n += 1;
  });

  const stepAvgSec: Record<string, number> = {};
  for (const [k, v] of Object.entries(byStep)) {
    stepAvgSec[k] = v.sum / Math.max(1, v.n);
  }

  // ✅ 되돌림은 action 재방문(연속중복 무시) 기준
  const backtracks = countRevisitsByActionNonConsecutive(rows);

  return {
    email: rows[0]?.user_email ?? '',
    totalMin: totalSec / 60,
    backtracks, // KPI
    stepAvgSec, // 각 step 평균(초)
  };
}

/** ====== Phase Summary: As-Is/To-Be 병합 ====== */
function buildPhaseSummaryMerged(asisRows: Row[], tobeRows: Row[]) {
  const fold = (rows: Row[]) => {
    const acc: Record<string, { sum: number; n: number }> = {};
    rows.forEach((r) => {
      const ph = phaseOf(r.step, r.action);
      const sec = toNum(r.duration_seconds_to_next);
      acc[ph] ??= { sum: 0, n: 0 };
      acc[ph].sum += sec;
      acc[ph].n += 1;
    });
    const out: Record<string, number> = {};
    const phases = new Set<string>([...Object.keys(acc), ...PHASES as unknown as string[]]);
    phases.forEach((p) => {
      const v = acc[p];
      out[p] = v ? v.sum / Math.max(1, v.n) / 60 : 0; // 분
    });
    return out;
  };

  const a = fold(asisRows);
  const t = fold(tobeRows);
  const union = Array.from(new Set([...Object.keys(a), ...Object.keys(t)]));
  return union.map((phase) => ({
    phase,
    asisMin: a[phase] ?? 0,
    tobeMin: t[phase] ?? 0,
  }));
}

/** ====== Timeline (간단 Gantt) ====== */
function buildTimelines(rows: Row[]) {
  const byUser = new Map<string, Row[]>();
  rows.forEach((r) => {
    const key = r.user_email ?? 'unknown';
    (byUser.get(key)?.push(r)) ?? byUser.set(key, [r]);
  });

  return Array.from(byUser.entries()).map(([user, list]) => {
    list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return {
      user,
      items: list.map((i) => ({
        start: i.created_at,
        end: i.next_created_at ?? i.created_at,
        step: i.step ?? 'Unknown',
        phase: phaseOf(i.step, i.action),
        sec: toNum(i.duration_seconds_to_next),
      })),
    };
  });
}

/** ====== 메인 핸들러 ====== */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const user = searchParams.get('user'); // optional

    const p_from = from ? new Date(from).toISOString() : null;
    const p_to = to ? new Date(to).toISOString() : null;

    const asis = getClient('asis');
    const tobe = getClient('tobe');

    // 병렬 조회
    const [asisRes, tobeRes] = await Promise.all([
      asis.rpc('get_usage_events', { p_from, p_to, p_user: user ?? null }),
      tobe.rpc('get_usage_events', { p_from, p_to, p_user: user ?? null }),
    ]);

    if (asisRes.error) return NextResponse.json({ error: asisRes.error.message }, { status: 500 });
    if (tobeRes.error) return NextResponse.json({ error: tobeRes.error.message }, { status: 500 });

    const rowsAsIs: Row[] = (asisRes.data ?? []) as Row[];
    const rowsToBe: Row[] = (tobeRes.data ?? []) as Row[];

    // 사용자별 요약
    const summarizeByUser = (rows: Row[]) => {
      const byUser = new Map<string, Row[]>();
      rows.forEach((r) => {
        const key = r.user_email ?? 'unknown';
        (byUser.get(key)?.push(r)) ?? byUser.set(key, [r]);
      });
      // 시간순 정렬 후 요약
      return Array.from(byUser.values()).map((list) => {
        list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        return buildUserSummary(list);
      });
    };

    const asisSummary = summarizeByUser(rowsAsIs);
    const tobeSummary = summarizeByUser(rowsToBe);

    const phaseSummary = buildPhaseSummaryMerged(rowsAsIs, rowsToBe);
    const timelinesAsIs = buildTimelines(rowsAsIs);
    const timelinesToBe = buildTimelines(rowsToBe);

    return NextResponse.json({
      asisSummary,
      tobeSummary,
      phaseSummary,
      timelines: timelinesAsIs, // 호환성: 기본은 As-Is
      timelinesAsIs,
      timelinesToBe,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
