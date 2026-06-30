import { describe, it, expect } from 'vitest';
import { parseCmdResponse } from '../cmd-schema';

describe('cmd-schema — create_invoice intent', () => {
  it('parses amount + description + vatRate + customer', () => {
    const r = parseCmdResponse(JSON.stringify({
      intent: 'create_invoice',
      summary: 'Έκδοση τιμολογίου 124€ στον Καραγιάννη.',
      params: { customerName: 'Καραγιάννης', invoiceAmount: 124, invoiceDescription: 'Παροχή υπηρεσιών', invoiceVatRate: 24 },
    }));
    expect(r.intent).toBe('create_invoice');
    expect(r.params.invoiceAmount).toBe(124);
    expect(r.params.invoiceDescription).toBe('Παροχή υπηρεσιών');
    expect(r.params.invoiceVatRate).toBe(24);
    expect(r.params.customerName).toBe('Καραγιάννης');
  });

  it('drops an invalid (non-number / non-positive) amount', () => {
    const r1 = parseCmdResponse(JSON.stringify({ intent: 'create_invoice', summary: 'x', params: { invoiceAmount: '124' } }));
    expect(r1.params.invoiceAmount).toBeUndefined();
    const r2 = parseCmdResponse(JSON.stringify({ intent: 'create_invoice', summary: 'x', params: { invoiceAmount: -5 } }));
    expect(r2.params.invoiceAmount).toBeUndefined();
  });

  it('does not attach invoice params to other intents', () => {
    const r = parseCmdResponse(JSON.stringify({ intent: 'create_task', summary: 'x', params: { invoiceAmount: 50 } }));
    expect(r.params.invoiceAmount).toBeUndefined();
  });

  it('clamps an out-of-range vatRate to undefined', () => {
    const r = parseCmdResponse(JSON.stringify({ intent: 'create_invoice', summary: 'x', params: { invoiceAmount: 100, invoiceVatRate: 250 } }));
    expect(r.params.invoiceVatRate).toBeUndefined();
  });
});
