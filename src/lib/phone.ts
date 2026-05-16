import type { Customer } from './types';

export function normalizePhone(phone: string): string {
  let clean = phone.replace(/[\s\-\(\)\.]/g, '').replace(/^\+/, '');
  if (clean.startsWith('0030')) clean = clean.slice(4);
  else if (clean.startsWith('30') && clean.length > 10) clean = clean.slice(2);
  return clean;
}

export function phonesMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return normalizePhone(a) === normalizePhone(b);
}

export function findCustomerByPhone(customers: Customer[], phone: string): Customer | undefined {
  if (!phone.trim()) return undefined;
  return customers.find(
    (c) =>
      phonesMatch(c.mobilePhone, phone) ||
      phonesMatch(c.landlinePhone, phone) ||
      phonesMatch(c.phone, phone)
  );
}

export function getCustomerPhoneKeys(customer: Customer): string[] {
  const keys = new Set<string>();
  for (const p of [customer.mobilePhone, customer.landlinePhone, customer.phone]) {
    if (p?.trim()) keys.add(normalizePhone(p.trim()));
  }
  return [...keys].filter(Boolean);
}

export function findDuplicateCustomerGroups(customers: Customer[]): Customer[][] {
  const phoneToIds = new Map<string, string[]>();
  for (const c of customers) {
    for (const key of getCustomerPhoneKeys(c)) {
      const arr = phoneToIds.get(key) ?? [];
      arr.push(c.id);
      phoneToIds.set(key, arr);
    }
  }
  const seenGroupKeys = new Set<string>();
  const groups: Customer[][] = [];
  for (const ids of phoneToIds.values()) {
    if (ids.length < 2) continue;
    const groupKey = [...ids].sort().join(':');
    if (seenGroupKeys.has(groupKey)) continue;
    seenGroupKeys.add(groupKey);
    const members = ids.map((id) => customers.find((c) => c.id === id)).filter(Boolean) as Customer[];
    if (members.length > 1) groups.push(members);
  }
  return groups;
}

export function isLikelyMobile(phone: string): boolean {
  const clean = phone.replace(/[\s\-\(\)\.\+]/g, '');
  // Greek mobile: 69XXXXXXXX, 069XXXXXXXX, 3069XXXXXXXX, 003069XXXXXXXX
  return /^(0030|30|0)?69\d{7,8}$/.test(clean);
}

export function getSmsPhone(customer: {
  phone?: string;
  mobilePhone?: string;
}): string | null {
  if (customer.mobilePhone?.trim()) return customer.mobilePhone.trim();
  if (customer.phone?.trim() && isLikelyMobile(customer.phone)) return customer.phone.trim();
  return null;
}

export function getMobilePhone(customer: {
  phone?: string;
  mobilePhone?: string;
}): string | null {
  return getSmsPhone(customer);
}

export function getLandlinePhone(customer: {
  phone?: string;
  landlinePhone?: string;
}): string | null {
  if (customer.landlinePhone?.trim()) return customer.landlinePhone.trim();
  if (customer.phone?.trim() && !isLikelyMobile(customer.phone)) return customer.phone.trim();
  return null;
}

export function getCallPhone(customer: {
  phone?: string;
  mobilePhone?: string;
  landlinePhone?: string;
}): string | null {
  if (customer.mobilePhone?.trim()) return customer.mobilePhone.trim();
  if (customer.landlinePhone?.trim()) return customer.landlinePhone.trim();
  if (customer.phone?.trim()) return customer.phone.trim();
  return null;
}
