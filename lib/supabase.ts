// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export type Which = 'ASIS' | 'TOBE';

function pick(...v: (string | undefined)[]) {
  return v.find(Boolean) ?? '';
}

export function getClient(which: Which) {
  const url = which === 'ASIS'
    ? pick(process.env.SUPABASE_ASIS_URL, process.env.NEXT_PUBLIC_SUPABASE_ASIS_URL)
    : pick(process.env.SUPABASE_TOBE_URL, process.env.NEXT_PUBLIC_SUPABASE_TOBE_URL);

  const key = which === 'ASIS'
    ? pick(process.env.SUPABASE_ASIS_ANON_KEY, process.env.NEXT_PUBLIC_SUPABASE_ASIS_ANON_KEY)
    : pick(process.env.SUPABASE_TOBE_ANON_KEY, process.env.NEXT_PUBLIC_SUPABASE_TOBE_ANON_KEY);

  if (!url || !key) throw new Error(`Missing Supabase envs for ${which}`);

  // ★ 핵심: 기본 스키마를 app으로 지정
  return createClient(url, key, {
    db: { schema: 'app' },
    auth: { persistSession: false },
  });
}
