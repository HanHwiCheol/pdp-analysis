// lib/loaders.ts
import { getClient, Which } from './supabase';
import { UsageRow } from './types';

export async function fetchEvents(params: {
  which: Which;
  from?: string; to?: string; user?: string;
}) {
  const { which, from, to, user } = params;
  const supa = getClient(which);

  // RPC 쓰는 버전
  const { data, error } = await supa.rpc('get_usage_events', {
    p_from: from ?? null,
    p_to: to ?? null,
    p_user: user ?? null,
  });

  if (error) throw error;
  return data as UsageRow[];
}

export function summarize(rows: UsageRow[]) {
  // 사용자별 총소요시간(첫~마지막), 단계별 평균, 되돌림 등
  const byUser = new Map<string, UsageRow[]>();
  rows.forEach(r => {
    const k = r.user_email ?? 'unknown';
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k)!.push(r);
  });
  // 정렬
  [...byUser.values()].forEach(arr => arr.sort((a,b) => +new Date(a.created_at) - +new Date(b.created_at)));

  const userSummaries = [...byUser.entries()].map(([email, arr]) => {
    const start = new Date(arr[0].created_at).getTime();
    const end   = new Date(arr[arr.length-1].created_at).getTime();
    const totalMin = (end - start) / 60000;

    // 반복(되돌림): 이전 step == 현재 step 혹은 패턴 EBOM→CATIA→EBOM 등
    let backtracks = 0;
    for (let i=1;i<arr.length;i++){
      const prev = arr[i-1].step ?? '';
      const cur  = arr[i].step ?? '';
      if (prev === cur) backtracks++;
    }
    // 단계별 평균 소요시간
    const stepDur: Record<string, {sum:number, n:number}> = {};
    arr.forEach(r => {
      if (r.step && r.duration_seconds_to_next != null) {
        const s = r.step;
        stepDur[s] ??= {sum:0, n:0};
        stepDur[s].sum += r.duration_seconds_to_next;
        stepDur[s].n++;
      }
    });

    return {
      email, totalMin,
      transitions: arr.length - 1,
      backtracks,
      stepAvgSec: Object.fromEntries(Object.entries(stepDur).map(([k,v])=>[k, v.sum/Math.max(1,v.n)])),
    };
  });

  return { userSummaries };
}
