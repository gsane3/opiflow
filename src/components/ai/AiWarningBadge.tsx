export default function AiWarningBadge({ message }: { message: string }) {
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
      <div>
        <p className="text-xs font-semibold text-amber-700">Χρειάζεται επιβεβαίωση</p>
        <p className="mt-0.5 text-xs text-amber-600">{message}</p>
      </div>
    </div>
  );
}
