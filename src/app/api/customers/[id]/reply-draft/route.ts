// POST /api/customers/[id]/reply-draft
//
// Drafts a short Greek reply to send to the customer, grounded in the recent
// conversation (call briefs + messages), the customer's needs, and the service
// catalog. Review-first: returns the text; the operator edits + taps send.
// Never auto-sends. INERT (503) when ANTHROPIC_API_KEY is unset.
//
// ADOPTED to the modular pattern (src/server/modules/customer-reply-draft): the
// grounding-context reads + prompt assembly + response-text extraction live in the
// service; the Anthropic call itself (model, headers, AbortController timeout) stays
// here VERBATIM.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { buildReplyDraftContext, extractDraftText, isRecord } from '@/server/modules/customer-reply-draft/customer-reply-draft.service';

export const runtime = 'nodejs';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 12_000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: customerId } = await params;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'ai_not_configured' }, { status: 503 });
  }

  // Optional operator hint ("πες του ότι θα έρθουμε αύριο").
  let hint = '';
  try {
    const body = await request.json();
    if (isRecord(body) && typeof body.hint === 'string') hint = body.hint.trim().slice(0, 300);
  } catch {
    // no body is fine
  }

  const context = await buildReplyDraftContext(supabase, businessId, customerId, hint);
  if (context.kind === 'not_found') {
    return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
  }
  const prompt = context.prompt;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0.5,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: 'ai_failed' }, { status: 502 });
    const data = await res.json().catch(() => null);
    const draft = extractDraftText(data);
    if (!draft) return NextResponse.json({ ok: false, error: 'ai_empty' }, { status: 502 });
    return NextResponse.json({ ok: true, draft });
  } catch {
    return NextResponse.json({ ok: false, error: 'ai_failed' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
