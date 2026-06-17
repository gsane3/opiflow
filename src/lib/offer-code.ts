// Builds a short, distinguishing code for an offer number from the customer
// name + project (work-folder) title — feedback #6. Example:
//   «Γιάννης Μπεζός» + «Επισκευή Κλιματισμού» → "GMEK"
// so an offer reads e.g. OFFER-9-2026-GMEK and is recognisable at a glance in
// lists and on the PDF. Greek initials are transliterated to Latin so the code
// is filename/URL-safe. Returns '' when there is nothing to derive from.

const GREEK_TO_LATIN: Record<string, string> = {
  Α: 'A', Β: 'V', Γ: 'G', Δ: 'D', Ε: 'E', Ζ: 'Z', Η: 'I', Θ: 'T', Ι: 'I',
  Κ: 'K', Λ: 'L', Μ: 'M', Ν: 'N', Ξ: 'X', Ο: 'O', Π: 'P', Ρ: 'R', Σ: 'S',
  Τ: 'T', Υ: 'Y', Φ: 'F', Χ: 'C', Ψ: 'P', Ω: 'O',
};

// Strip combining diacritics (Ά→Α, ό→ο, …) without a combining-char regex.
function stripDiacritics(input: string): string {
  return Array.from(input.normalize('NFD'))
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp < 0x0300 || cp > 0x036f;
    })
    .join('');
}

function initialOf(word: string): string {
  const first = word.trim().charAt(0).toUpperCase();
  if (!first) return '';
  if (GREEK_TO_LATIN[first]) return GREEK_TO_LATIN[first];
  // Letters only — keeping digits out of the code guarantees the offer-number
  // running counter (extracted from the numeric segments) can never be fooled
  // by a digit-leading customer/project word.
  if (/[A-Z]/.test(first)) return first;
  return '';
}

export function buildOfferCode(
  customerName: string | null | undefined,
  projectTitle: string | null | undefined,
  maxLen = 6
): string {
  const source = stripDiacritics([customerName, projectTitle].filter(Boolean).join(' '));
  const words = source.split(/\s+/).filter(Boolean);
  let code = '';
  for (const w of words) {
    code += initialOf(w);
    if (code.length >= maxLen) break;
  }
  return code.slice(0, maxLen);
}
