import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ACTIVITY_CALENDAR,
  getActivityDateBounds,
  loadActivityCalendar,
  normalizeActivityCalendar,
  validateActivityCalendar
} from '../src/utils/activityCalendar.js';
import { createActivityLogSearchPattern } from '../src/utils/activityLogSearch.js';
import { isRequestCatalogItemAvailable, normalizeCatalog } from '../src/utils/documentCatalog.js';

test('default calendar configuration matches current semester ranges', () => {
  assert.deepEqual(normalizeActivityCalendar(), DEFAULT_ACTIVITY_CALENDAR);
  assert.equal(validateActivityCalendar(DEFAULT_ACTIVITY_CALENDAR), null);
});

test('activity calendar falls back to defaults only when its database column is missing', async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({
          data: null,
          error: {
            code: '42703',
            message: 'column system_settings.activity_calendar does not exist'
          }
        })
      })
    })
  };

  assert.deepEqual(await loadActivityCalendar(supabase), DEFAULT_ACTIVITY_CALENDAR);
});

test('activity calendar lookup still throws unrelated database errors', async () => {
  const databaseError = { code: '42P01', message: 'relation system_settings does not exist' };
  const supabase = {
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: databaseError })
      })
    })
  };

  await assert.rejects(loadActivityCalendar(supabase), error => error === databaseError);
});

test('school year 2026-2027 uses August through the following July in Manila time', () => {
  const result = getActivityDateBounds({ periodType: 'school', year: '2026' });

  assert.deepEqual(result, {
    lo: '2026-07-31T16:00:00.000Z',
    hi: '2027-07-31T16:00:00.000Z'
  });
});

test('school-year semester ranges map second semester into the following calendar year', () => {
  const result = getActivityDateBounds({
    periodType: 'school',
    year: '2026',
    semester: 'Second Semester'
  });

  assert.deepEqual(result, {
    lo: '2026-12-31T16:00:00.000Z',
    hi: '2027-05-31T16:00:00.000Z'
  });
});

test('calendar year and semester filters intersect within the selected calendar year', () => {
  const result = getActivityDateBounds({
    periodType: 'calendar',
    year: '2026',
    semester: 'First Semester'
  });

  assert.deepEqual(result, {
    lo: '2026-07-31T16:00:00.000Z',
    hi: '2026-12-31T16:00:00.000Z'
  });
});

test('month and date range filters intersect using inclusive local calendar dates', () => {
  const result = getActivityDateBounds({
    periodType: 'calendar',
    year: '2026',
    month: '10',
    startDate: '2026-10-05',
    endDate: '2026-10-08'
  });

  assert.deepEqual(result, {
    lo: '2026-10-04T16:00:00.000Z',
    hi: '2026-10-08T16:00:00.000Z'
  });
});

test('calendar settings reject invalid or overlapping semester months', () => {
  assert.match(validateActivityCalendar({
    schoolYearStartMonth: 9,
    semesters: DEFAULT_ACTIVITY_CALENDAR.semesters
  }), /starts in August/);

  assert.match(validateActivityCalendar({
    schoolYearStartMonth: 8,
    semesters: {
      first: { startMonth: 8, endMonth: 12 },
      second: { startMonth: 10, endMonth: 1 },
      summer: { startMonth: 6, endMonth: 7 }
    }
  }), /overlaps/);

  assert.match(validateActivityCalendar({
    schoolYearStartMonth: 8,
    semesters: {
      first: { startMonth: 8, endMonth: 12 },
      second: { startMonth: 11, endMonth: 2 },
      summer: { startMonth: 6, endMonth: 7 }
    }
  }), /overlaps/);
});

test('date bounds reject impossible dates, reversed ranges, and unknown semesters', () => {
  assert.match(getActivityDateBounds({ date: '2026-02-30' }).error, /Invalid date/);
  assert.match(getActivityDateBounds({ startDate: '2026-10-10', endDate: '2026-10-09' }).error, /after end date/);
  assert.match(getActivityDateBounds({ semester: 'Winter' }).error, /Invalid semester/);
});

test('search pattern treats SQL LIKE metacharacters as literal input', () => {
  assert.equal(createActivityLogSearchPattern('REQ_100%*\\x'), '%REQ\\_100\\%\\*\\\\x%');
  assert.equal(createActivityLogSearchPattern('  Super Admin  '), '%Super Admin%');
});

test('configured semester wrapping December to February crosses into the following year', () => {
  const calendar = {
    schoolYearStartMonth: 8,
    semesters: {
      first: { startMonth: 8, endMonth: 11 },
      second: { startMonth: 12, endMonth: 2 },
      summer: { startMonth: 6, endMonth: 7 }
    }
  };
  const result = getActivityDateBounds({
    periodType: 'school',
    year: '2026',
    semester: 'second',
    calendar
  });

  assert.deepEqual(result, {
    lo: '2026-11-30T16:00:00.000Z',
    hi: '2027-02-28T16:00:00.000Z'
  });
});

test('catalog normalization preserves archived metadata but marks it unavailable for new requests', () => {
  const archived = normalizeCatalog([{
    id: 'legacy-fee',
    name: 'Legacy Request Type',
    category: 'Document',
    allowedRoles: ['student'],
    fee: 37.5,
    feeUnit: 'per_copy',
    active: true,
    archived: true
  }])[0];

  assert.equal(archived.archived, true);
  assert.equal(archived.fee, 37.5);
  assert.equal(archived.name, 'Legacy Request Type');
  assert.equal(isRequestCatalogItemAvailable(archived), false);
});