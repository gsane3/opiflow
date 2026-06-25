import { describe, it, expect } from 'vitest';
import { createAccount, updateAccount } from '../bank-accounts.service';

// These exercise the route's exact validation contract (invalid_iban). The IBAN check
// runs BEFORE any data-layer call, so the assertions stay hermetic (no DB).

describe('bank-accounts validation (parity)', () => {
  it('createAccount rejects a missing or malformed IBAN', async () => {
    await expect(createAccount('b1', {})).rejects.toMatchObject({ code: 'invalid_iban', status: 400 });
    await expect(createAccount('b1', { iban: 'XX' })).rejects.toMatchObject({ code: 'invalid_iban', status: 400 });
    await expect(createAccount('b1', { iban: 'not an iban' })).rejects.toMatchObject({ code: 'invalid_iban' });
    await expect(createAccount('b1', { iban: 12345 })).rejects.toMatchObject({ code: 'invalid_iban' });
  });
  it('updateAccount rejects a missing or malformed IBAN before touching the store', async () => {
    await expect(updateAccount('b1', 'a1', {})).rejects.toMatchObject({ code: 'invalid_iban', status: 400 });
    await expect(updateAccount('b1', 'a1', { iban: 'GR12' })).rejects.toMatchObject({ code: 'invalid_iban' });
  });
});
