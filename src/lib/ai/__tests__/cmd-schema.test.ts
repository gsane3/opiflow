import { describe, it, expect } from 'vitest';
import { parseCmdResponse } from '../cmd-schema';

describe('parseCmdResponse — create_project', () => {
  it('parses a create_project intent with customer + projectTitle', () => {
    const r = parseCmdResponse(
      JSON.stringify({
        intent: 'create_project',
        summary: 'Νέο έργο για τον Καραγιάννη.',
        params: { customerName: 'Καραγιάννης', projectTitle: 'Επισκευή θέρμανσης' },
      })
    );
    expect(r.intent).toBe('create_project');
    expect(r.params.customerName).toBe('Καραγιάννης');
    expect(r.params.projectTitle).toBe('Επισκευή θέρμανσης');
  });

  it('accepts create_project with no projectTitle (app supplies a default)', () => {
    const r = parseCmdResponse(
      JSON.stringify({ intent: 'create_project', summary: 'Νέο έργο.', params: { customerName: 'Νίκος' } })
    );
    expect(r.intent).toBe('create_project');
    expect(r.params.projectTitle).toBeUndefined();
  });
});

describe('parseCmdResponse — projectTitle scoping', () => {
  it('keeps projectTitle for create_appointment', () => {
    const r = parseCmdResponse(
      JSON.stringify({
        intent: 'create_appointment',
        summary: 'Ραντεβού.',
        params: { customerName: 'Γιώργος', projectTitle: 'Συντήρηση καυστήρα', dueDate: '2026-06-25', appointmentType: 'book_appointment' },
      })
    );
    expect(r.intent).toBe('create_appointment');
    expect(r.params.projectTitle).toBe('Συντήρηση καυστήρα');
    expect(r.params.appointmentType).toBe('book_appointment');
  });

  it('keeps projectTitle for create_offer', () => {
    const r = parseCmdResponse(
      JSON.stringify({
        intent: 'create_offer',
        summary: 'Προσφορά.',
        params: {
          customerName: 'Αλεξάνδρου',
          projectTitle: 'Ανακαίνιση μπάνιου',
          offerItems: [{ description: 'Υλικά', quantity: 1, unitPrice: 3500 }],
        },
      })
    );
    expect(r.intent).toBe('create_offer');
    expect(r.params.projectTitle).toBe('Ανακαίνιση μπάνιου');
    expect(r.params.offerItems).toHaveLength(1);
  });

  it('drops projectTitle for intents that do not file into a project', () => {
    const r = parseCmdResponse(
      JSON.stringify({
        intent: 'create_task',
        summary: 'Task.',
        params: { customerName: 'Γιώργος', projectTitle: 'Άσχετο', title: 'Κάλεσε' },
      })
    );
    expect(r.intent).toBe('create_task');
    expect(r.params.projectTitle).toBeUndefined();
    expect(r.params.title).toBe('Κάλεσε');
  });

  it('clamps an over-long projectTitle to 120 chars', () => {
    const long = 'Α'.repeat(200);
    const r = parseCmdResponse(
      JSON.stringify({ intent: 'create_project', summary: 's', params: { customerName: 'Χ', projectTitle: long } })
    );
    expect(r.params.projectTitle?.length).toBe(120);
  });
});
