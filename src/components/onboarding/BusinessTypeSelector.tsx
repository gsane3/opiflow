'use client';

import type { BusinessType } from '@/lib/types';

const options: Array<{
  value: BusinessType;
  label: string;
  description: string;
  emoji: string;
}> = [
  {
    value: 'technical_services',
    label: 'Τεχνικές υπηρεσίες',
    description: 'HVAC, υδραυλικός, ηλεκτρολόγος, μηχανικός',
    emoji: '🔧',
  },
  {
    value: 'sales_services',
    label: 'Πωλήσεις / υπηρεσίες',
    description: 'Ασφαλιστής, σύμβουλος, μεσίτης',
    emoji: '💼',
  },
  {
    value: 'projects_construction',
    label: 'Κατασκευές / έργα',
    description: 'Ανακαινίσεις, εργολάβος, κατασκευαστής',
    emoji: '🏗️',
  },
  {
    value: 'other',
    label: 'Άλλο',
    description: 'Οποιοδήποτε άλλο επάγγελμα',
    emoji: '⚙️',
  },
];

interface Props {
  value: BusinessType | null;
  onChange: (type: BusinessType) => void;
}

export default function BusinessTypeSelector({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
              selected
                ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] hover:border-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
            }`}
          >
            <span className="text-2xl leading-none">{option.emoji}</span>
            <div>
              <p
                className={`text-sm font-semibold ${
                  selected ? 'text-indigo-700' : 'text-zinc-800 dark:text-zinc-200'
                }`}
              >
                {option.label}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{option.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
