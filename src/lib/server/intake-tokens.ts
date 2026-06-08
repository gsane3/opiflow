import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const TOKEN_BYTES = 32;
const DEFAULT_EXPIRY_HOURS = 72;

interface ServerEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export interface IntakeTokenRow {
  id: string;
  business_id: string;
  customer_id: string;
  token_hash: string;
  status: 'pending' | 'sent' | 'opened' | 'submitted' | 'expired' | 'revoked';
  sent_channel: 'viber' | 'sms' | 'email' | 'manual' | null;
  sent_to_phone: string | null;
  expires_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIntakeTokenResult {
  rawToken: string;
  tokenHash: string;
  intakeUrl: string;
  row: IntakeTokenRow;
}

function requireServerEnv(): ServerEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase server env');
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
}

export function createServiceSupabaseClient() {
  const env = requireServerEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function generateRawIntakeToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashIntakeToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function getPublicAppUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (appUrl) {
    return appUrl.replace(/\/$/, '');
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return 'http://localhost:3000';
}

export function buildIntakeUrl(rawToken: string): string {
  return `${getPublicAppUrl()}/intake/${encodeURIComponent(rawToken)}`;
}

export async function createCustomerIntakeToken(params: {
  businessId: string;
  customerId: string;
  phone?: string | null;
  sentChannel?: 'viber' | 'sms' | 'email' | 'manual' | null;
  expiryHours?: number;
}): Promise<CreateIntakeTokenResult> {
  const supabase = createServiceSupabaseClient();

  const rawToken = generateRawIntakeToken();
  const tokenHash = hashIntakeToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (params.expiryHours ?? DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from('customer_intake_tokens')
    .insert({
      business_id: params.businessId,
      customer_id: params.customerId,
      token_hash: tokenHash,
      status: params.sentChannel ? 'sent' : 'pending',
      sent_channel: params.sentChannel ?? null,
      sent_to_phone: params.phone ?? null,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create intake token: ${error.message}`);
  }

  return {
    rawToken,
    tokenHash,
    intakeUrl: buildIntakeUrl(rawToken),
    row: data as IntakeTokenRow,
  };
}

export async function markIntakeTokenSent(params: {
  tokenId: string;
  sentChannel: 'viber' | 'sms' | 'email' | 'manual';
  sentToPhone?: string | null;
}): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('customer_intake_tokens')
    .update({
      status: 'sent',
      sent_channel: params.sentChannel,
      sent_to_phone: params.sentToPhone ?? null,
      updated_at: now,
    })
    .eq('id', params.tokenId)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to mark intake token sent: ${error.message}`);
  }
}

export async function findValidIntakeToken(rawToken: string): Promise<IntakeTokenRow | null> {
  const supabase = createServiceSupabaseClient();
  const tokenHash = hashIntakeToken(rawToken);

  const { data, error } = await supabase
    .from('customer_intake_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .in('status', ['pending', 'sent', 'opened'])
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find intake token: ${error.message}`);
  }

  return data ? (data as IntakeTokenRow) : null;
}

export async function markIntakeTokenOpened(tokenId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('customer_intake_tokens')
    .update({
      status: 'opened',
      opened_at: now,
      updated_at: now,
    })
    .eq('id', tokenId)
    .in('status', ['pending', 'sent']);

  if (error) {
    throw new Error(`Failed to mark intake token opened: ${error.message}`);
  }
}

export async function markIntakeTokenSubmitted(tokenId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('customer_intake_tokens')
    .update({
      status: 'submitted',
      submitted_at: now,
      updated_at: now,
    })
    .eq('id', tokenId);

  if (error) {
    throw new Error(`Failed to mark intake token submitted: ${error.message}`);
  }
}
