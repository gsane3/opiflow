import { NextRequest, NextResponse } from 'next/server';
import { buildPrompt } from '@/lib/ai/prompt';
import { parseAiResponse } from '@/lib/ai/schema';
import type { BusinessType } from '@/lib/types';

// MVP-only in-memory rate limiter. Resets on cold start; not shared across
// multiple serverless instances. Sufficient for protecting the API key in MVP.
const AI_REVIEW_RATE_LIMIT_WINDOW_MS = 60_000;
const AI_REVIEW_RATE_LIMIT_MAX = 10;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + AI_REVIEW_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= AI_REVIEW_RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // API key is server-only — never sent to client
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'no_api_key' }, { status: 503 });
  }

  let body: {
    inputText?: string;
    businessType?: BusinessType;
    businessName?: string;
    defaultVatRate?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const inputText = (body.inputText ?? '').trim();
  if (!inputText || inputText.length > 2000) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const prompt = buildPrompt({
    inputText,
    businessType: body.businessType,
    businessName: body.businessName,
    defaultVatRate: body.defaultVatRate,
  });

  let rawText: string;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('Anthropic API error:', res.status, await res.text());
      return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
    }

    const data = await res.json() as { content?: Array<{ text?: string }> };
    rawText = data?.content?.[0]?.text ?? '';
  } catch (err) {
    console.error('Anthropic fetch error:', err);
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
  }

  let parsed: unknown;
  try {
    // Strip optional markdown code fences the model may add
    const cleaned = rawText
      .replace(/^```(?:json)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('AI response JSON parse failed. Raw:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'invalid_response' }, { status: 502 });
  }

  const result = parseAiResponse(parsed);
  return NextResponse.json({ result });
}
