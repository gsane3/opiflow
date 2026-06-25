// Phone — shared types for the five /api/phone routes (twilio-token,
// browser-token, telephony, presence, recording). DB-row shapes + result DTOs.

/** twilio-token / browser-token gate inputs (read off businesses + subscriptions). */
export interface BizNumberRow {
  business_phone_number?: string | null;
}

export interface SubStatusRow {
  status?: string;
}

/** telephony GET row. */
export interface TelephonyRow {
  telephony_mode?: string | null;
  forwarding_source_number?: string | null;
  business_phone_number?: string | null;
}

/** presence GET row. */
export interface PresenceRow {
  status?: string;
  updated_at?: string;
}

/** recording GET row. */
export interface RecordingRow {
  record_calls?: boolean | null;
}

/** A browser SIP endpoint row (per-user credential path). */
export interface BrowserSipEndpointRow {
  id: string;
  sip_username: string | null;
  sip_password_enc: string | null;
  status: string;
}

/** Resolved per-user SIP credential (post-decrypt). */
export interface PerUserCredential {
  sipUsername: string;
  sipPassword: string;
}
