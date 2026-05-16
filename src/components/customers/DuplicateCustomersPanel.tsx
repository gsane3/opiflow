'use client';

import type { Customer } from '@/lib/types';
import { findDuplicateCustomerGroups, getCustomerPhoneKeys } from '@/lib/phone';

function getSharedPhone(group: Customer[]): string | null {
  const counts = new Map<string, number>();
  for (const c of group) {
    for (const k of getCustomerPhoneKeys(c)) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of counts.entries()) {
    if (n > 1) return k;
  }
  return null;
}

interface Props {
  customers: Customer[];
  onMerge: (primaryId: string, duplicateId: string) => void;
}

export default function DuplicateCustomersPanel({ customers, onMerge }: Props) {
  const groups = findDuplicateCustomerGroups(customers);
  if (groups.length === 0) return null;

  function handleMergeGroup(group: Customer[]) {
    const totalDuplicates = group.length - 1;
    if (
      !window.confirm(
        `Να συγχωνευτούν οι διπλές καρτέλες; Θα διαγραφούν ${totalDuplicates} και τα στοιχεία τους θα μεταφερθούν στη βασική. Δεν υπάρχει undo.`
      )
    )
      return;
    const [primary, ...duplicates] = group;
    for (const dup of duplicates) {
      onMerge(primary.id, dup.id);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-amber-900">Πιθανές διπλές καρτέλες</p>
        <p className="text-xs text-amber-700">
          Βρέθηκαν καρτέλες με ίδιο τηλέφωνο. Η βασική κρατά τα στοιχεία της, η διπλή διαγράφεται.
        </p>
      </div>
      <ul className="space-y-2">
        {groups.map((group, i) => {
          const [primary] = group;
          const shared = getSharedPhone(group);
          return (
            <li key={i} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-amber-100 space-y-2">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {group.map((c) => (
                  <span key={c.id} className="text-xs text-zinc-700">
                    <span className="font-medium">
                      {c.crmNumber ? `Πελάτης ${c.crmNumber} — ` : ''}{c.name}
                    </span>
                  </span>
                ))}
              </div>
              {shared && (
                <p className="text-xs text-zinc-400">Κοινό τηλέφωνο: {shared}</p>
              )}
              <button
                type="button"
                onClick={() => handleMergeGroup(group)}
                className="rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-50"
              >
                Συγχώνευση στη βασική καρτέλα ({primary.crmNumber ?? primary.name})
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
