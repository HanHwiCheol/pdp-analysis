// lib/types.ts
export type UsageRow = {
  user_email: string | null;
  treetable_id: string | null;
  step: string | null;
  action: string | null;
  detail: any | null;
  created_at: string;           // ISO
  next_created_at: string | null;
  duration_seconds_to_next: number | null;
  prev_step: string | null;
  next_step: string | null;
};

export type UsageEventRow = {
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

// Phase 색상 (Timeline용)
const PHASE_COLOR: Record<string, string> = {
  'Preparation': '#6B7280',   // slate-500
  'Design': '#F59E0B',   // amber-500
  'Integration': '#06B6D4',   // cyan-500
  'Verification': '#22C55E',   // green-500
  'Stage/Finish': '#A855F7',   // violet-500
  'Other': '#9CA3AF',   // gray-400
};

