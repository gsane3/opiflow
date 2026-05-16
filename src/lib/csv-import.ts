import type { Customer } from './types';
import { phonesMatch } from './phone';

export interface CsvColumn {
  index: number;
  header: string;
  known: boolean;
}

export interface CsvRow {
  rowIndex: number;
  raw: string[];
  issues: string[];
}

export interface CsvImportPreview {
  columns: CsvColumn[];
  rows: CsvRow[];
  totalRows: number;
  hasIssues: boolean;
  globalIssues: string[];
}

const KNOWN_COLUMNS = new Set([
  'name', 'companyName', 'mobilePhone', 'landlinePhone', 'phone',
  'email', 'address', 'source', 'status', 'preferredContactMethod',
  'opportunityValue', 'needsSummary', 'notes', 'crmNumber',
]);

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let inQuotes = false;
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseCustomerCsv(text: string): CsvImportPreview {
  // Strip UTF-8 BOM if present
  const clean = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) {
    return { columns: [], rows: [], totalRows: 0, hasIssues: true, globalIssues: ['Το αρχείο είναι κενό.'] };
  }

  const headers = parseCsvLine(lines[0]);
  const columns: CsvColumn[] = headers.map((h, i) => ({
    index: i,
    header: h,
    known: KNOWN_COLUMNS.has(h),
  }));

  const unknownCols = columns.filter(c => !c.known).map(c => c.header);
  const globalIssues: string[] = unknownCols.length > 0
    ? [`Άγνωστες στήλες: ${unknownCols.join(', ')}`]
    : [];

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const mobileIdx = headers.indexOf('mobilePhone');
  const landlineIdx = headers.indexOf('landlinePhone');
  const legacyPhoneIdx = headers.indexOf('phone');

  // Detect duplicate phones/emails in the CSV itself
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  const rows: CsvRow[] = lines.slice(1, 51).map((line, i) => {
    const raw = parseCsvLine(line);
    const issues: string[] = [];
    const name = nameIdx >= 0 ? raw[nameIdx] : '';
    if (!name?.trim()) issues.push('Λείπει το όνομα');
    const mobile = mobileIdx >= 0 ? raw[mobileIdx] : '';
    const landline = landlineIdx >= 0 ? raw[landlineIdx] : '';
    const legacyPhone = legacyPhoneIdx >= 0 ? raw[legacyPhoneIdx] : '';
    const anyPhone = mobile || landline || legacyPhone;
    const email = emailIdx >= 0 ? raw[emailIdx] : '';
    if (!anyPhone?.trim() && !email?.trim()) issues.push('Λείπει τηλέφωνο και email');
    if (anyPhone) {
      const norm = anyPhone.trim();
      if (seenPhones.has(norm)) issues.push('Διπλότυπο τηλέφωνο στο CSV');
      else seenPhones.add(norm);
    }
    if (email) {
      const normEmail = email.trim().toLowerCase();
      if (seenEmails.has(normEmail)) issues.push('Διπλότυπο email στο CSV');
      else seenEmails.add(normEmail);
    }
    return { rowIndex: i + 1, raw, issues };
  });

  return {
    columns,
    rows,
    totalRows: lines.length - 1,
    hasIssues: globalIssues.length > 0 || rows.some(r => r.issues.length > 0),
    globalIssues,
  };
}

export interface CsvImportRow {
  name: string;
  companyName: string;
  mobilePhone: string;
  landlinePhone: string;
  phone: string;
  email: string;
  address: string;
  source: string;
  status: string;
  preferredContactMethod: string;
  opportunityValue?: number;
  needsSummary: string;
  notes: string;
}

export function parseCsvToRows(text: string, headers: string[]): CsvImportRow[] {
  const clean = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).filter(l => l.trim()).slice(1);
  return lines.map(line => {
    const cells = parseCsvLine(line);
    const get = (h: string) => cells[headers.indexOf(h)]?.trim() ?? '';
    const oppVal = get('opportunityValue');
    return {
      name: get('name'),
      companyName: get('companyName'),
      mobilePhone: get('mobilePhone'),
      landlinePhone: get('landlinePhone'),
      phone: get('phone'),
      email: get('email'),
      address: get('address'),
      source: get('source') || 'manual_entry',
      status: get('status') || 'new_lead',
      preferredContactMethod: get('preferredContactMethod') || 'phone',
      opportunityValue: oppVal ? Number(oppVal) : undefined,
      needsSummary: get('needsSummary'),
      notes: get('notes'),
    };
  });
}

export function detectCrmDuplicates(rows: CsvImportRow[], existingCustomers: Customer[]): Set<number> {
  const duplicateIndices = new Set<number>();
  rows.forEach((row, i) => {
    const isDup = existingCustomers.some(c =>
      (row.mobilePhone && phonesMatch(c.mobilePhone, row.mobilePhone)) ||
      (row.landlinePhone && phonesMatch(c.landlinePhone, row.landlinePhone)) ||
      (row.phone && phonesMatch(c.phone, row.phone)) ||
      (row.email && c.email?.toLowerCase() === row.email.toLowerCase())
    );
    if (isDup) duplicateIndices.add(i);
  });
  return duplicateIndices;
}
