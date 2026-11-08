// Edge Function "ai": analyze, link and transcribe through Groq for signed-in users.
// Secrets: GROQ_API_KEY (required), AI_DAILY_CAP (optional). See docs/PLAN.md for setup.
import { createSupabaseContext } from 'npm:@supabase/server@1';
import { DEFAULT_DAILY_CAP } from './config.js';
import { handle } from './handler.js';

const cap = Number.parseInt(Deno.env.get('AI_DAILY_CAP') ?? '', 10) || DEFAULT_DAILY_CAP;

Deno.serve((req) => handle(req, {
  groqKey: Deno.env.get('GROQ_API_KEY'),
  cap,
  async authenticate(request) {
    const { data: ctx, error } = await createSupabaseContext(request, { auth: 'user' });
    const userId = ctx?.userClaims?.id;
    if (error || !userId) return null;
    return {
      userId,
      async takeCall(limit) {
        const { data, error: rpcError } = await ctx.supabaseAdmin.rpc('take_ai_call', { p_user: userId, p_cap: limit });
        if (rpcError) throw new Error(rpcError.code ?? 'rpc failed');
        return data === true;
      },
    };
  },
}));
