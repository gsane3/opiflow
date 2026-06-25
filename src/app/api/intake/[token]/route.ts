import { NextRequest, NextResponse } from 'next/server';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';
import { sendPushToBusinessOwner } from '@/lib/server/push';
import {
  loadIntake,
  resolveIntakeForSubmit,
  submitIntake,
} from '@/server/modules/public-intake/public-intake.service';

export const runtime = 'nodejs';

// Public endpoint — rate-limit by IP to deter abuse/scraping.
const publicLimiter = makePublicLimiter(40, 60_000);

function buildPublicIntakeRedirect(
  token: string,
  request: NextRequest,
  submitted = false
): URL {
  const publicBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  const origin = publicBaseUrl || request.nextUrl.origin;
  const suffix = submitted ? '?submitted=1' : '';

  return new URL(`/intake/${encodeURIComponent(token)}${suffix}`, origin);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const result = await loadIntake(token);

    if (result.kind === 'invalid') {
      return NextResponse.json({ ok: false, error: 'intake_link_invalid_or_expired' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      customer: result.customer,
      business: result.business,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'intake_load_failed' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

  const contentType = request.headers.get('content-type') ?? '';
  const acceptsJson = contentType.includes('application/json');
  const acceptsForm =
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data');

  if (!acceptsJson && !acceptsForm) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  try {
    const { token } = await params;
    const resolved = await resolveIntakeForSubmit(token);

    if (!resolved) {
      if (acceptsForm) {
        return NextResponse.redirect(buildPublicIntakeRedirect(token, request), 303);
      }

      return NextResponse.json({ ok: false, error: 'intake_link_invalid_or_expired' }, { status: 404 });
    }

    let raw: Record<string, unknown>;

    if (acceptsJson) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
      }

      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
      }

      raw = body as Record<string, unknown>;
    } else {
      const formData = await request.formData();
      raw = Object.fromEntries(formData.entries());
    }

    const result = await submitIntake(resolved, raw, { notifyOwner: sendPushToBusinessOwner });

    if (result.kind === 'missing_name') {
      if (acceptsForm) {
        return NextResponse.redirect(buildPublicIntakeRedirect(token, request), 303);
      }

      return NextResponse.json({ ok: false, error: 'missing_name' }, { status: 400 });
    }

    if (result.kind === 'customer_update_failed') {
      if (acceptsForm) {
        return NextResponse.redirect(buildPublicIntakeRedirect(token, request), 303);
      }

      return NextResponse.json({ ok: false, error: 'customer_update_failed' }, { status: 500 });
    }

    if (result.kind === 'customer_not_found') {
      if (acceptsForm) {
        return NextResponse.redirect(buildPublicIntakeRedirect(token, request), 303);
      }

      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    if (acceptsForm) {
      return NextResponse.redirect(buildPublicIntakeRedirect(token, request, true), 303);
    }

    return NextResponse.json({
      ok: true,
      customer: result.customer,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'intake_submit_failed' }, { status: 500 });
  }
}
