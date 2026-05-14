import type { CallType } from '@/lib/types';

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  inbound_new_customer: 'Εισερχόμενη από νέο πελάτη',
  inbound_existing_customer: 'Εισερχόμενη από υπάρχοντα πελάτη',
  outbound_new_lead: 'Εξερχόμενη σε νέο lead',
  outbound_existing_customer: 'Εξερχόμενη σε υπάρχοντα πελάτη',
};

const CALL_TYPE_DETAILS: Array<{
  value: CallType;
  label: string;
  description: string;
  direction: 'inbound' | 'outbound';
}> = [
  {
    value: 'inbound_new_customer',
    label: 'Εισερχόμενη από νέο πελάτη',
    description: 'Άγνωστος καλεί — πιθανός νέος πελάτης',
    direction: 'inbound',
  },
  {
    value: 'inbound_existing_customer',
    label: 'Εισερχόμενη από υπάρχοντα πελάτη',
    description: 'Γνωστός πελάτης του CRM καλεί',
    direction: 'inbound',
  },
  {
    value: 'outbound_new_lead',
    label: 'Εξερχόμενη σε νέο lead',
    description: 'Καλούμε νέο lead για πρώτη επαφή',
    direction: 'outbound',
  },
  {
    value: 'outbound_existing_customer',
    label: 'Εξερχόμενη σε υπάρχοντα πελάτη',
    description: 'Καλούμε γνωστό πελάτη του CRM',
    direction: 'outbound',
  },
];

interface Props {
  value: CallType | null;
  onChange: (type: CallType) => void;
}

function InboundIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-zinc-400'}`}
      fill="none"
      strokeWidth={1.5}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5 4.5 19.5m0 0h11.25m-11.25 0V8.25" />
    </svg>
  );
}

function OutboundIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-zinc-400'}`}
      fill="none"
      strokeWidth={1.5}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
    </svg>
  );
}

export default function CallTypeSelector({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {CALL_TYPE_DETAILS.map((item) => {
        const selected = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
              selected
                ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
            }`}
          >
            <div className="mt-0.5">
              {item.direction === 'inbound' ? (
                <InboundIcon active={selected} />
              ) : (
                <OutboundIcon active={selected} />
              )}
            </div>
            <div>
              <p
                className={`text-sm font-semibold ${
                  selected ? 'text-indigo-700' : 'text-zinc-800'
                }`}
              >
                {item.label}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">{item.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
