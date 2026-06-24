// Resolve a caller's phone number to a display NAME for the live ring / in-call
// screen (#10). Two sources, in priority order:
//   1. Opiflow CRM customer (richer identity) — last-10-digit match via the same
//      /api/customers?q= search the intake prompt uses.
//   2. Device phone contacts — ONLY if contacts permission is ALREADY granted
//      (never prompt during an incoming ring).
// Best-effort and fully async: any failure falls back to null so the caller's
// number still shows and the ring is never delayed. Results are cached per number.

import * as Contacts from 'expo-contacts';

import { apiGet } from '@/lib/api';

const last10 = (s?: string | null) => (s ? s.replace(/\D/g, '').slice(-10) : '');

// last-10-digits → resolved name (or null = "looked up, no match"). Avoids
// re-hitting the API / address book on every call to the same number.
const nameCache = new Map<string, string | null>();

// Device address book, built once (last-10-digits → contact name).
let contactsMap: Map<string, string> | null = null;
let contactsLoaded = false;

async function loadDeviceContacts(): Promise<Map<string, string>> {
  if (contactsLoaded && contactsMap) return contactsMap;
  contactsLoaded = true;
  const map = new Map<string, string>();
  try {
    // getPermissionsAsync (NOT request) — never pop a permission dialog over a ring.
    const perm = await Contacts.getPermissionsAsync();
    if (perm.status === 'granted') {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      for (const c of data) {
        const nm = c.name?.trim();
        if (!nm || !c.phoneNumbers) continue;
        for (const p of c.phoneNumbers) {
          const d = last10(p.number);
          if (d.length >= 8 && !map.has(d)) map.set(d, nm);
        }
      }
    }
  } catch {
    // best-effort: no contacts access → CRM match only
  }
  contactsMap = map;
  return map;
}

async function lookupCustomerName(number: string, digits: string): Promise<string | null> {
  try {
    const found = await apiGet<{ customers?: Array<{ name?: string | null; phone?: string | null; mobilePhone?: string | null; landlinePhone?: string | null }> }>(
      `/api/customers?q=${encodeURIComponent(number)}&limit=5`,
    );
    const m = (found?.customers ?? []).find(
      (cu) => [cu.phone, cu.mobilePhone, cu.landlinePhone].some((p) => last10(p) === digits),
    );
    return m?.name?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a number to a display name, or null if unknown. Opiflow customer wins
 * over a device contact. Cached. Never throws.
 */
export async function resolveCallerName(number: string | null): Promise<string | null> {
  const digits = last10(number);
  if (digits.length < 8) return null; // not a real number (e.g. a SIP client id)
  if (nameCache.has(digits)) return nameCache.get(digits) ?? null;

  let name = await lookupCustomerName(number as string, digits);
  if (!name) {
    const map = await loadDeviceContacts();
    name = map.get(digits) ?? null;
  }
  nameCache.set(digits, name);
  return name;
}
