// Component-level tests for UserAttendanceScreen.
//
// The full screen is heavy (location, fingerprint, camera, navigation,
// nativewind, animations) so we don't fully render it here. Instead we
// verify the file's exports and assert structural invariants the user
// cares about (e.g. the late-reason popup uses the right title text,
// the checkout confirmation message mentions the no-rejoin rule, etc.).
//
// Reading the file as a string is brittle vs broad refactors but it is
// fast, cheap, and catches regressions where someone reverts the design
// to an older variant.

import fs from 'fs';
import path from 'path';

const SCREEN_PATH = path.resolve(
  __dirname,
  '..',
  'UserAttendanceScreen.js'
);

const screenText = fs.readFileSync(SCREEN_PATH, 'utf8');

describe('UserAttendanceScreen — late reason popup design', () => {
  test('popup title is "You\'re Late"', () => {
    expect(screenText).toContain("You're Late");
  });

  test('popup uses the schedule (clock) icon', () => {
    expect(screenText).toMatch(/MaterialIcons[\s\S]*name="schedule"/);
  });

  test('popup label asks for a reason', () => {
    expect(screenText).toContain('Please provide a reason');
  });

  test('popup placeholder explains reason input', () => {
    expect(screenText).toContain('Enter your reason for being late');
  });

  test('popup submit button is labelled "Submit Reason"', () => {
    expect(screenText).toContain('Submit Reason');
  });

  test('popup shows salary deduction text when amount > 0', () => {
    expect(screenText).toContain('Salary deduction');
  });

  test('popup shows late sequence in this month', () => {
    expect(screenText).toContain('this month');
  });

  test('popup is gated on isLate true', () => {
    expect(screenText).toMatch(/justCreated\.isLate/);
  });

  test('Submit Reason button calls submitLateReason with attendance id + text', () => {
    expect(screenText).toMatch(/submitLateReason\(pendingLateAttendanceId/);
  });
});

describe('UserAttendanceScreen — checkout confirmation', () => {
  test('check-out alert mentions the no-rejoin rule', () => {
    expect(screenText).toContain('Once checked out, you cannot check in again to this session');
  });

  test('confirm button text is "YES, CHECK OUT"', () => {
    expect(screenText).toContain('YES, CHECK OUT');
  });

  test('cancel button text is "CANCEL"', () => {
    expect(screenText).toContain('CANCEL');
  });
});

describe('UserAttendanceScreen — late-reason state machine', () => {
  test('declares showLateReasonModal state', () => {
    expect(screenText).toMatch(/useState\([\s\S]{0,40}\)\s*\)?[\s\S]*setShowLateReasonModal/);
    // Looser — just ensure both setters/getters exist
    expect(screenText).toContain('showLateReasonModal');
    expect(screenText).toContain('setShowLateReasonModal');
  });

  test('declares lateReasonText state', () => {
    expect(screenText).toContain('lateReasonText');
    expect(screenText).toContain('setLateReasonText');
  });

  test('declares pendingLateAttendanceId for late submit flow', () => {
    expect(screenText).toContain('pendingLateAttendanceId');
  });
});

describe('UserAttendanceScreen — check-out uses the current server record', () => {
  // processCheckOut body, up to the next top-level handler.
  const start = screenText.indexOf('const processCheckOut = async');
  const body = screenText.slice(start, screenText.indexOf('\n  const ', start + 10));

  test('re-reads today\'s attendance before writing check_out', () => {
    const reread = body.indexOf('getTodayAttendanceByEmployeeId(verifiedEmployee.id');
    const write = body.indexOf('checkOutToOdoo(');
    expect(reread).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(reread);
  });

  test('only switches to an OPEN record that differs from the one on screen', () => {
    expect(body).toMatch(/fresh\?\.id && !fresh\.checkOut && fresh\.id !== attendanceId/);
  });

  test('check-out write and photo upload both use the re-read id', () => {
    expect(body).toContain('checkOutToOdoo(attendanceId)');
    expect(body).toContain("uploadAttendancePhoto(attendanceId, photoBase64, 'check_out')");
    expect(body).not.toContain('checkOutToOdoo(todayAttendance.id)');
  });

  test("shows the service's error message when check-out fails", () => {
    expect(body).toContain("showAlert({ message: result.error || 'Check-out failed' })");
  });
});

describe('UserAttendanceScreen — field check-out time comes from the server', () => {
  const start = screenText.indexOf('const processFieldCheckOut = async');
  const body = screenText.slice(start, screenText.indexOf('\n  const ', start + 10));

  test('uses field_action_check_out (server now), not a device-time write', () => {
    expect(body).toContain('fieldActionCheckOutOdoo(fieldData.attendance_id)');
    expect(screenText).not.toContain('checkOutFieldAttendanceOdoo');
  });

  test('surfaces the server error, ignoring an already-closed record', () => {
    expect(body).toContain("res.error !== 'already_checked_out'");
  });
});

describe('UserAttendanceScreen — session badge and "Session N complete" card', () => {
  test('badge shows the session and its office hours', () => {
    expect(screenText).toContain('`SESSION ${info.session}  ·  ${info.start} – ${info.end}`');
  });

  test('Office and Field both show the badge', () => {
    expect(screenText).toContain('renderSessionBadge(todayAttendance');
    expect(screenText).toContain('renderSessionBadge(fieldData?.checkin_session)');
    expect(screenText).toContain('renderSessionBadge(fieldDetail?.checkin_session || fieldData?.checkin_session)');
  });

  test('after Session 1 the card says when Session 2 opens', () => {
    expect(screenText).toContain('`Check in again for Session 2 from ${info.nextStart}`');
  });

  test('Office check-out no longer says "All Done!" after Session 1', () => {
    expect(screenText).toContain('hasCheckedOut && renderSessionCompleteCard(');
    expect(screenText).not.toContain('Your attendance is complete for today');
  });
});
