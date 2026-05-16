interface AiWarningBadgeProps {
  message: string;
  onDismiss?: () => void;
}

export default function AiWarningBadge({ message, onDismiss }: AiWarningBadgeProps) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
        fill="none"
        strokeWidth={2}
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-amber-700">Χρειάζεται επιβεβαίωση</p>
        <p className="mt-0.5 text-xs text-amber-600">{message}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Απόρριψη προειδοποίησης"
          className="shrink-0 rounded p-0.5 text-amber-500 transition hover:bg-amber-100 hover:text-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
        >
          <svg className="h-3.5 w-3.5" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
