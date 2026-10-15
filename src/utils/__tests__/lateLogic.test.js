// Tests for the session helpers behind the Office / Field session badge and
// the "Session N complete" card.

import { sessionAt, sessionHours } from '../lateLogic';

const split = {
  shift_type: 'split',
  office_start_hour: 9.0,
  office_end_hour: 14.0,
  office_start_hour_2: 15.0,
  office_end_hour_2: 21.5,
  timezone: 'Asia/Kolkata',
};
const single = { ...split, shift_type: 'single' };

// 2026-10-15 in Asia/Kolkata (UTC+5:30), built from UTC so the test does not
// depend on the machine's timezone.
const ist = (h, m) => new Date(Date.UTC(2026, 9, 15, h, m) - 330 * 60 * 1000);

describe('sessionAt', () => {
  test('before the Session 2 start is Session 1', () => {
    expect(sessionAt(ist(9, 5), split)).toBe('1');
    expect(sessionAt(ist(14, 59), split)).toBe('1');
  });

  test('from the Session 2 start on is Session 2', () => {
    expect(sessionAt(ist(15, 0), split)).toBe('2');
    expect(sessionAt(ist(20, 30), split)).toBe('2');
  });

  test('single shift and missing config are always Session 1', () => {
    expect(sessionAt(ist(16, 0), single)).toBe('1');
    expect(sessionAt(ist(16, 0), null)).toBe('1');
  });
});

describe('sessionHours', () => {
  test('Session 1 hours and when Session 2 opens', () => {
    expect(sessionHours(split, '1')).toEqual({
      session: '1', start: '09:00', end: '14:00', nextStart: '15:00',
    });
  });

  test('Session 2 hours, nothing after it', () => {
    expect(sessionHours(split, 2)).toEqual({
      session: '2', start: '15:00', end: '21:30', nextStart: null,
    });
  });

  test('single shift has no session badge', () => {
    expect(sessionHours(single, '1')).toBeNull();
    expect(sessionHours(null, '1')).toBeNull();
  });
});
