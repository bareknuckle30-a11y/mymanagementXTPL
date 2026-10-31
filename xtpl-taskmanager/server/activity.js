import { supabase, supabaseEnabled } from './supabase.js';

export async function recordActivity({ actor, action, taskId = null, metadata = {} }) {
  if (!supabaseEnabled) return;
  const { error } = await supabase.from('task_activity').insert({
    actor_user_id: actor?.id || null,
    task_id: taskId || null,
    action,
    metadata,
  });
  if (error) console.error('[activity] insert failed:', error.message);
}

export async function recentActivity(limit = 20) {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase
    .from('task_activity')
    .select('id, action, metadata, created_at, actor_user_id, task_id')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100));
  if (error) throw error;
  return data || [];
}
