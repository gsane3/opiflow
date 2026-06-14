'use client';

import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (dataUrl: string) => void;
}

export default function LogoUpload({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Θα εμφανίζεται στο preview της προσφοράς.{' '}
        <span className="text-zinc-400 dark:text-zinc-500">
          Στο MVP αποθηκεύεται μόνο τοπικά στον browser.
        </span>
      </p>

      <div
        className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 p-8 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-white/15 dark:bg-[#1e2b38] dark:hover:bg-indigo-500/10"
        onClick={() => inputRef.current?.click()}
      >
        {value ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={value}
            alt="Logo preview"
            className="h-20 w-auto max-w-full rounded-lg object-contain"
          />
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 dark:bg-[#26384a]">
              <svg
                className="h-6 w-6 text-zinc-500 dark:text-zinc-400"
                fill="none"
                strokeWidth={1.5}
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                />
              </svg>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Πάτα για να ανεβάσεις εικόνα</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">PNG, JPG, SVG</p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {value && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-sm text-indigo-600 hover:text-indigo-700"
          >
            Αλλαγή
          </button>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Αφαίρεση
          </button>
        </div>
      )}
    </div>
  );
}
