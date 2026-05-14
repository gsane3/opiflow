'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadState, saveState } from '@/lib/storage';
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
    subtitle: 'Προαιρετικό — μπορείς να το παραλείψεις.',
  },
  {
    title: 'ΦΠΑ & Όροι προσφορών',
    subtitle: 'Προεπιλεγμένες ρυθμίσεις για νέες προσφορές.',
  },
];

function buildInitialFormData(): FormData {
  const state = loadState();
  return {
    businessType: null,
    businessName: '',
    ownerName: state.userProfile?.name ?? '',
    phone: '',
    email: state.userProfile?.email ?? '',
    address: '',
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

  useEffect(() => {
    const state = loadState();
    if (!state.userProfile) {
      router.replace('/login');
    } else if (state.userProfile.onboardingCompleted) {
      router.replace('/dashboard');
    }
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

  function handleComplete() {
    const state = loadState();
    if (!state.userProfile) return;

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

    saveState({
      userProfile: { ...state.userProfile, onboardingCompleted: true },
      businessProfile,
      workspace: {
        id: crypto.randomUUID(),
        name: formData.businessName.trim() || state.userProfile.name,
        mode: 'mock_local',
      },
    });

    router.push('/dashboard');
  }

  const profileFormValue: BusinessProfileData = {
    businessName: formData.businessName,
    ownerName: formData.ownerName,
    phone: formData.phone,
    email: formData.email,
    address: formData.address,
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
              <BusinessProfileForm
                value={profileFormValue}
                onChange={(fields) => updateForm(fields)}
              />
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
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
          >
            {isLastStep ? 'Ολοκλήρωση' : 'Συνέχεια'}
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
