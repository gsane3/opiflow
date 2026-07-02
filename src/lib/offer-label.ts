// PURE, dependency-free — safe to import from services AND notification builders
// (offer-accept.ts pulls the push/supabase chain, which test contexts can't load).

/** «OFFER-24-2026-DRADR» → «Νο 24/2026» — the codes mean nothing to the owner. */
export function offerShortLabel(offerNumber: string): string {
  const m = offerNumber.match(/^OFFER-(\d+)-(\d{4})/);
  return m ? `Νο ${m[1]}/${m[2]}` : offerNumber;
}

export const euroLabel = (n: number) =>
  n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR' });
