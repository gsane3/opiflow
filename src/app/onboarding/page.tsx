'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadState, saveState } from '@/lib/storage';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { BusinessType, BusinessProfile } from '@/lib/types';
import BusinessTypeSelector from '@/components/onboarding/BusinessTypeSelector';
import BusinessProfileForm, {
  type BusinessProfileData,
} from '@/components/onboarding/BusinessProfileForm';
import LogoUpload from '@/components/onboarding/LogoUpload';
import VatAndTermsForm from '@/components/onboarding/VatAndTermsForm';

interface FormData {
  businessType: BusinessType | null;
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  vatNumber: string;
  taxOffice: string;
  logoDataUrl: string;
  vatRate: number;
  offerTerms: string;
}

const DEFAULT_OFFER_TERMS =
  'Η παρούσα προσφορά ισχύει για 30 ημέρες από την ημερομηνία έκδοσης. Οι τιμές δεν περιλαμβάνουν αλλαγές εκτός του συμφωνημένου αντικειμένου εργασίας.';

const STEPS = [
  {
    title: 'Τύπος επιχείρησης',
    subtitle: 'Τι είδους επαγγελματίας είσαι;',
  },
  {
    title: 'Στοιχεία επιχείρησης',
    subtitle: 'Αυτά τα στοιχεία θα εμφανίζονται στις προσφορές σου.',
  },
  {
    title: 'Logo επιχείρησης',
    subtitle: 'Προαιρετικό. Μπορείς να το παραλείψεις.',
  },
  {
    title: 'ΦΠΑ & Όροι προσφορών',
    subtitle: 'Προεπιλεγμένες ρυθμίσεις για νέες προσφορές.',
  },
];

function buildInitialFormData(): FormData {
  return {
    businessType: null,
    businessName: '',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    vatNumber: '',
    taxOffice: '',
    logoDataUrl: '',
    vatRate: 24,
    offerTerms: DEFAULT_OFFER_TERMS,
  };
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<FormData>(buildInitialFormData);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    async function checkSession() {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          router.replace('/login');
          return;
        }
        setAccessToken(session.access_token);
        try {
          const raw = localStorage.getItem('yorgos_onboarding_prefill');
          const prefill = raw
            ? (JSON.parse(raw) as { ownerName?: string; email?: string })
            : null;
          setFormData((prev) => ({
            ...prev,
            ownerName: prefill?.ownerName?.trim() || prev.ownerName,
            email: prefill?.email?.trim() || session.user.email || prev.email,
          }));
        } catch {
          // non-fatal
        }
      } catch {
        router.replace('/login');
      }
    }
    checkSession();
  }, [router]);

  function updateForm(fields: Partial<FormData>) {
    setFormData((prev) => ({ ...prev, ...fields }));
    setError('');
  }

  function handleNext() {
    if (step === 0 && !formData.businessType) {
      setError('Επέλεξε τύπο επιχείρησης για να συνεχίσεις.');
      return;
    }
    if (step === 1 && !formData.businessName.trim()) {
      setError('Το όνομα επιχείρησης είναι υποχρεωτικό.');
      return;
    }
    if (step === 1 && !formData.ownerName.trim()) {
      setError('Το ονοματεπώνυμο είναι υποχρεωτικό.');
      return;
    }
    setError('');
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleComplete();
    }
  }

  function handleBack() {
    setError('');
    setStep((s) => s - 1);
  }

  async function handleComplete() {
    if (submitting) return;
    if (!accessToken) {
      router.replace('/login');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    let res: Response;
    try {
      res = await fetch('/api/businesses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: formData.businessName.trim(),
          type: formData.businessType,
          phone: formData.phone.trim() || null,
          email: formData.email.trim() || null,
          address: formData.address.trim() || null,
          city: formData.city.trim() || null,
          vat_number: formData.vatNumber.trim() || null,
          tax_office: formData.taxOffice.trim() || null,
          default_vat_rate: formData.vatRate,
          default_offer_terms: formData.offerTerms.trim() || null,
          preferred_contact_method: 'viber',
        }),
      });
    } catch {
      setSubmitError('Δεν μπορέσαμε να αποθηκεύσουμε την επιχείρηση. Δοκίμασε ξανά.');
      setSubmitting(false);
      return;
    }
    if (res.status === 201 || res.status === 409) {
      try {
        const state = loadState();
        const now = new Date().toISOString();
        const businessProfile: BusinessProfile = {
          id: crypto.randomUUID(),
          businessName: formData.businessName.trim(),
          businessType: formData.businessType!,
          ownerName: formData.ownerName.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim(),
          address: formData.address.trim(),
          vatNumber: formData.vatNumber.trim(),
          taxOffice: formData.taxOffice.trim(),
          logoDataUrl: formData.logoDataUrl,
          defaultVatRate: formData.vatRate,
          defaultOfferTerms: formData.offerTerms.trim(),
          defaultAcceptanceText:
            'Αποδέχομαι τους παραπάνω όρους και επιθυμώ να προχωρήσουμε.',
          preferredContactMethod: 'viber',
          createdAt: now,
          updatedAt: now,
        };
        if (state.userProfile) {
          saveState({
            userProfile: { ...state.userProfile, onboardingCompleted: true },
            businessProfile,
            workspace: {
              id: crypto.randomUUID(),
              name: formData.businessName.trim(),
              mode: 'mock_local',
            },
          });
        }
      } catch {
        // localStorage write failure is non-fatal
      }
      try { localStorage.removeItem('yorgos_onboarding_prefill'); } catch { /* non-fatal */ }
      router.push('/number');
      return;
    }
    setSubmitError('Δεν μπορέσαμε να αποθηκεύσουμε την επιχείρηση. Δοκίμασε ξανά.');
    setSubmitting(false);
  }

  const profileFormValue: BusinessProfileData = {
    businessName: formData.businessName,
    ownerName: formData.ownerName,
    phone: formData.phone,
    email: formData.email,
    address: formData.address,
    city: formData.city,
    vatNumber: formData.vatNumber,
    taxOffice: formData.taxOffice,
  };

  const currentStep = STEPS[step];
  const isLastStep = step === STEPS.length - 1;
  const isLogoStep = step === 2;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-zinc-100 bg-white px-4 py-4">
        <div className="mx-auto max-w-lg">
          <p className="text-sm font-bold text-zinc-900">yorgos.ai</p>
          <div className="mt-3 flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                  i <= step ? 'bg-indigo-600' : 'bg-zinc-200'
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Βήμα {step + 1} από {STEPS.length}
          </p>
        </div>
      </header>

      <div className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-lg">
          <h1 className="text-xl font-semibold text-zinc-900">
            {currentStep.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{currentStep.subtitle}</p>

          <div className="mt-6">
            {step === 0 && (
              <BusinessTypeSelector
                value={formData.businessType}
                onChange={(type) => updateForm({ businessType: type })}
              />
            )}
            {step === 1 && (
              <>
                <BusinessProfileForm
                  value={profileFormValue}
                  onChange={(fields) => updateForm(fields)}
                />
                <p className="mt-3 text-xs text-zinc-400">
                  Το τηλέφωνο εδώ είναι κινητό επικοινωνίας. Ο επαγγελματικός αριθμός σου δίνεται αυτόματα από το yorgos.ai.
                </p>
              </>
            )}
            {step === 2 && (
              <LogoUpload
                value={formData.logoDataUrl}
                onChange={(dataUrl) => updateForm({ logoDataUrl: dataUrl })}
              />
            )}
            {step === 3 && (
              <VatAndTermsForm
                vatRate={formData.vatRate}
                offerTerms={formData.offerTerms}
                onChangeVat={(rate) => updateForm({ vatRate: rate })}
                onChangeTerms={(terms) => updateForm({ offerTerms: terms })}
              />
            )}
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-zinc-100 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-lg gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 active:bg-zinc-100"
            >
              Πίσω
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={isLastStep && submitting}
            className={`flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800${isLastStep && submitting ? ' opacity-60 cursor-not-allowed' : ''}`}
          >
            {isLastStep && submitting ? 'Αποθήκευση...' : isLastStep ? 'Ολοκλήρωση' : 'Συνέχεια'}
          </button>
        </div>
        {isLogoStep && (
          <div className="mx-auto mt-2 max-w-lg text-center">
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="text-sm text-zinc-400 hover:text-zinc-600"
            >
              Παράλειψη
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
