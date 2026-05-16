export type DemoTruthVariant = 'demo' | 'local_only' | 'no_send' | 'no_cloud';

const VARIANT_LABELS: Record<DemoTruthVariant, string> = {
  demo: 'Demo',
  local_only: 'Τοπικό μόνο',
  no_send: 'Δεν γίνεται αποστολή',
  no_cloud: 'Χωρίς cloud sync',
};

interface Props {
  variant?: DemoTruthVariant;
  label?: string;
}

export default function DemoTruthBadge({ variant = 'demo', label }: Props) {
  return (
    <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
      {label ?? VARIANT_LABELS[variant]}
    </span>
  );
}
