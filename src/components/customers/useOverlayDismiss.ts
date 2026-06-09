'use client';

// Shared overlay behaviour for the customer slide-overs/sheets: close on Escape
// and lock body scroll while open (the same pattern BottomSheet + FileGallery
// use). Captures/restores the previous body overflow so STACKED overlays
// (Info → OfferPreview → SendViaViberModal) nest safely. onClose is read via a
// ref so an inline-arrow prop does not retrigger the lock every render.

import { useEffect, useRef } from 'react';

export function useOverlayDismiss(open: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  useEffect(() => { cb.current = onClose; });

  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;

    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') cb.current(); }
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);
}
