import { describe, it, expect } from 'vitest';
import {
  appointmentCanRespond,
  timeChangeOptions,
  APPOINTMENT_TYPES,
  FINAL_TASK_STATUSES,
} from '../appointment-status';

describe('appointment-status', () => {
  describe('appointmentCanRespond', () => {
    it('blocks final statuses', () => {
      for (const status of FINAL_TASK_STATUSES) {
        expect(appointmentCanRespond({ status, type: 'book_appointment', due_date: '2999-12-31' })).toBe(false);
      }
    });
    it('blocks non-appointment task types', () => {
      expect(appointmentCanRespond({ status: 'open', type: 'call_back', due_date: '2999-12-31' })).toBe(false);
    });
    it('blocks a missing or past due_date', () => {
      expect(appointmentCanRespond({ status: 'open', type: 'book_appointment', due_date: null })).toBe(false);
      expect(appointmentCanRespond({ status: 'open', type: 'book_appointment', due_date: '2000-01-01' })).toBe(false);
    });
    it('allows an open, future, appointment-type task', () => {
      for (const type of APPOINTMENT_TYPES) {
        expect(appointmentCanRespond({ status: 'open', type, due_date: '2999-12-31' })).toBe(true);
      }
    });
  });

  describe('timeChangeOptions', () => {
    it('returns exactly the −1h and +1h slots', () => {
      expect(timeChangeOptions('2026-07-01', '10:30')).toEqual([
        { date: '2026-07-01', time: '09:30' },
        { date: '2026-07-01', time: '11:30' },
      ]);
    });
    it('rolls the date across midnight', () => {
      expect(timeChangeOptions('2026-07-01', '00:30')).toEqual([
        { date: '2026-06-30', time: '23:30' },
        { date: '2026-07-01', time: '01:30' },
      ]);
    });
    it('returns [] for an unparseable slot', () => {
      expect(timeChangeOptions('bad', '10:30')).toEqual([]);
    });
  });
});
