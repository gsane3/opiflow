'use client';

import { useEffect, useRef } from 'react';
import type { CustomerFileRecord } from '@/lib/customer-files';

export interface GalleryFile {
  record: CustomerFileRecord;
  objectUrl: string;
}

interface Props {
  files: GalleryFile[];
  currentIndex: number;
  onClose: () => void;
  onChangeIndex: (index: number) => void;
}

export default function CustomerMediaGallery({
  files,
  currentIndex,
  onClose,
  onChangeIndex,
}: Props) {
  const current = files[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < files.length - 1;
  const touchStartX = useRef<number | null>(null);

  // Keyboard navigation — event listener callbacks calling setState in parent are OK.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        onChangeIndex(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && hasNext) {
        onChangeIndex(currentIndex + 1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentIndex, hasPrev, hasNext, onClose, onChangeIndex]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta > 50 && hasPrev) onChangeIndex(currentIndex - 1);
    else if (delta < -50 && hasNext) onChangeIndex(currentIndex + 1);
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm text-zinc-400">
          {currentIndex + 1} / {files.length}
        </span>
        <p className="min-w-0 flex-1 truncate text-center text-sm text-zinc-300">
          {current.record.fileName}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Κλείσιμο"
        >
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Media area with swipe support */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Previous button */}
        <button
          type="button"
          onClick={() => hasPrev && onChangeIndex(currentIndex - 1)}
          disabled={!hasPrev}
          className="absolute left-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-default disabled:opacity-20"
          aria-label="Προηγούμενο"
        >
          <svg className="h-5 w-5" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        {/* Media content */}
        <div className="mx-14 flex max-h-full max-w-4xl flex-1 items-center justify-center">
          {current.record.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={current.record.id}
              src={current.objectUrl}
              alt={current.record.fileName}
              className="max-h-[75vh] max-w-full rounded-lg object-contain"
              draggable={false}
            />
          )}

          {current.record.kind === 'video' && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={current.record.id}
              src={current.objectUrl}
              controls
              className="max-h-[75vh] max-w-full rounded-lg"
            />
          )}

          {current.record.kind === 'other' && (
            <div className="flex flex-col items-center gap-4 rounded-2xl bg-zinc-800 px-8 py-10 text-center">
              <svg className="h-12 w-12 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              <p className="text-sm text-zinc-300">{current.record.fileName}</p>
              <a
                href={current.objectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                Άνοιγμα σε νέο tab
              </a>
            </div>
          )}
        </div>

        {/* Next button */}
        <button
          type="button"
          onClick={() => hasNext && onChangeIndex(currentIndex + 1)}
          disabled={!hasNext}
          className="absolute right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-default disabled:opacity-20"
          aria-label="Επόμενο"
        >
          <svg className="h-5 w-5" fill="none" strokeWidth={2.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {/* Bottom dot indicators (up to 10 dots) */}
      {files.length > 1 && files.length <= 10 && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 py-4">
          {files.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChangeIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === currentIndex ? 'w-4 bg-white' : 'w-1.5 bg-zinc-600 hover:bg-zinc-400'
              }`}
              aria-label={`Αρχείο ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Swipe hint on mobile — shown once, very subtle */}
      {files.length > 1 && (
        <p className="shrink-0 pb-3 text-center text-xs text-zinc-600">
          Σύρε για πλοήγηση
        </p>
      )}
    </div>
  );
}
