export const DEFAULT_ACTIVITY_CALENDAR = Object.freeze({
  schoolYearStartMonth: 8,
  semesters: Object.freeze({
    first: Object.freeze({ startMonth: 8, endMonth: 12 }),
    second: Object.freeze({ startMonth: 1, endMonth: 5 }),
    summer: Object.freeze({ startMonth: 6, endMonth: 7 })
  })
});

const SEMESTER_KEYS = ['first', 'second', 'summer'];
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export const normalizeActivityCalendar = (value) => {
  const startMonth = Number(value?.schoolYearStartMonth);
  const schoolYearStartMonth = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12
    ? startMonth
    : DEFAULT_ACTIVITY_CALENDAR.schoolYearStartMonth;

  const semesters = Object.fromEntries(SEMESTER_KEYS.map((key) => {
    const range = value?.semesters?.[key];
    const start = Number(range?.startMonth);
    const end = Number(range?.endMonth);
    const startOffset = (start - schoolYearStartMonth + 12) % 12;
    const endOffset = (end - schoolYearStartMonth + 12) % 12;
    const valid = Number.isInteger(start) && start >= 1 && start <= 12
      && Number.isInteger(end) && end >= 1 && end <= 12 && endOffset >= startOffset;
    return [key, valid
      ? { startMonth: start, endMonth: end }
      : { ...DEFAULT_ACTIVITY_CALENDAR.semesters[key] }];
  }));

  return { schoolYearStartMonth, semesters };
};

export const loadActivityCalendar = async (supabase) => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('activity_calendar')
    .maybeSingle();

  const errorText = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  const missingCalendarColumn = ['42703', 'PGRST204'].includes(error?.code)
    && /activity_calendar/i.test(errorText);

  if (missingCalendarColumn) return DEFAULT_ACTIVITY_CALENDAR;
  if (error) throw error;

  return normalizeActivityCalendar(data?.activity_calendar || DEFAULT_ACTIVITY_CALENDAR);
};

export const validateActivityCalendar = (value) => {
  const startMonth = Number(value?.schoolYearStartMonth);
  if (startMonth !== 8) {
    return 'The TRAC school year starts in August.';
  }
  const schoolYearStartMonth = startMonth;

  const ranges = [];
  for (const key of SEMESTER_KEYS) {
    const range = value?.semesters?.[key];
    const start = Number(range?.startMonth);
    const end = Number(range?.endMonth);
    if (!Number.isInteger(start) || start < 1 || start > 12
      || !Number.isInteger(end) || end < 1 || end > 12) {
      return `${key} semester needs a valid start and end month.`;
    }
    ranges.push({ key, start, end });
  }

  const occupied = new Map();
  for (const { key, start, end } of ranges) {
    const startOffset = (start - schoolYearStartMonth + 12) % 12;
    const endOffset = (end - schoolYearStartMonth + 12) % 12;
    if (endOffset < startOffset) return `${key} semester end must follow its start within the school year.`;
    for (let offset = startOffset; offset <= endOffset; offset += 1) {
      const month = ((schoolYearStartMonth - 1 + offset) % 12) + 1;
      const previous = occupied.get(offset);
      if (previous) return `${key} semester overlaps with ${previous} in ${month}.`;
      occupied.set(offset, key);
    }
  }
  return null;
};

const manilaMidnightUtc = (year, month, day = 1) => (
  Date.UTC(year, month - 1, day) - MANILA_OFFSET_MS
);

const monthEndExclusive = (year, month) => (
  month === 12 ? manilaMidnightUtc(year + 1, 1) : manilaMidnightUtc(year, month + 1)
);

export const getActivityDateBounds = ({
  periodType = 'calendar',
  year,
  semester,
  month,
  date,
  startDate,
  endDate,
  calendar = DEFAULT_ACTIVITY_CALENDAR,
  now = new Date()
}) => {
  if (!['calendar', 'school'].includes(periodType)) {
    return { error: 'Invalid year type.' };
  }

  const normalizedCalendar = normalizeActivityCalendar(calendar);
  const localDateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric'
  }).formatToParts(now);
  const currentLocalYear = Number(localDateParts.find((part) => part.type === 'year')?.value);
  const currentLocalMonth = Number(localDateParts.find((part) => part.type === 'month')?.value);
  const defaultYear = periodType === 'school' && currentLocalMonth < normalizedCalendar.schoolYearStartMonth
    ? currentLocalYear - 1
    : currentLocalYear;
  const selectedYear = year === undefined || year === '' ? defaultYear : Number(year);
  if (!Number.isInteger(selectedYear) || selectedYear < 1900 || selectedYear > 9998) {
    return { error: 'Invalid year filter.' };
  }

  const isValidDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [dateYear, dateMonth, dateDay] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(dateYear, dateMonth - 1, dateDay));
    return parsed.getUTCFullYear() === dateYear
      && parsed.getUTCMonth() === dateMonth - 1
      && parsed.getUTCDate() === dateDay;
  };

  if (date && !isValidDate(date)) return { error: 'Invalid date filter.' };
  if (startDate && !isValidDate(startDate)) return { error: 'Invalid start date filter.' };
  if (endDate && !isValidDate(endDate)) return { error: 'Invalid end date filter.' };
  if (startDate && endDate && startDate > endDate) return { error: 'Start date must not be after end date.' };

  const monthNumber = month === undefined || month === '' ? null : Number(month);
  if (monthNumber !== null && (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12)) {
    return { error: 'Invalid month filter.' };
  }

  let lo = -Infinity;
  let hi = Infinity;
  const narrow = (start, end) => {
    lo = Math.max(lo, start);
    hi = Math.min(hi, end);
  };

  if (periodType === 'calendar') {
    if (year !== undefined && year !== '') {
      narrow(manilaMidnightUtc(selectedYear, 1), manilaMidnightUtc(selectedYear + 1, 1));
    }
    if (monthNumber !== null) {
      const monthYear = periodType === 'calendar' ? selectedYear : selectedYear;
      narrow(manilaMidnightUtc(monthYear, monthNumber), monthEndExclusive(monthYear, monthNumber));
    }
    if (semester) {
      const label = String(semester).trim().toLowerCase();
      const key = label.startsWith('first') || label.startsWith('1st') ? 'first'
        : label.startsWith('second') || label.startsWith('2nd') ? 'second'
          : label.startsWith('summer') ? 'summer' : label;
      const range = normalizedCalendar.semesters[key];
      if (!range) return { error: 'Invalid semester filter.' };
      const endYear = range.endMonth < range.startMonth ? selectedYear + 1 : selectedYear;
      narrow(manilaMidnightUtc(selectedYear, range.startMonth), monthEndExclusive(endYear, range.endMonth));
    }
  } else {
    const schoolYearStart = normalizedCalendar.schoolYearStartMonth;
    const hasSchoolYearPeriod = (year !== undefined && year !== '') || semester || monthNumber !== null;
    if (hasSchoolYearPeriod) {
      narrow(
        manilaMidnightUtc(selectedYear, schoolYearStart),
        manilaMidnightUtc(selectedYear + 1, schoolYearStart)
      );
    }

    const getSchoolYearCalendarYear = (monthValue) => (
      monthValue >= schoolYearStart ? selectedYear : selectedYear + 1
    );

    if (monthNumber !== null) {
      const monthYear = getSchoolYearCalendarYear(monthNumber);
      narrow(manilaMidnightUtc(monthYear, monthNumber), monthEndExclusive(monthYear, monthNumber));
    }
    if (semester) {
      const label = String(semester).trim().toLowerCase();
      const key = label.startsWith('first') || label.startsWith('1st') ? 'first'
        : label.startsWith('second') || label.startsWith('2nd') ? 'second'
          : label.startsWith('summer') ? 'summer' : label;
      const range = normalizedCalendar.semesters[key];
      if (!range) return { error: 'Invalid semester filter.' };
      const semesterStartYear = getSchoolYearCalendarYear(range.startMonth);
      const semesterEndYear = range.endMonth < range.startMonth
        ? semesterStartYear + 1
        : getSchoolYearCalendarYear(range.endMonth);
      narrow(
        manilaMidnightUtc(semesterStartYear, range.startMonth),
        monthEndExclusive(semesterEndYear, range.endMonth)
      );
    }
  }

  if (date) {
    const [dateYear, dateMonth, dateDay] = date.split('-').map(Number);
    narrow(manilaMidnightUtc(dateYear, dateMonth, dateDay), manilaMidnightUtc(dateYear, dateMonth, dateDay + 1));
  }
  if (startDate) {
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    narrow(manilaMidnightUtc(startYear, startMonth, startDay), Infinity);
  }
  if (endDate) {
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    narrow(-Infinity, manilaMidnightUtc(endYear, endMonth, endDay + 1));
  }

  if (lo > hi) return { empty: true, lo, hi };
  return {
    lo: Number.isFinite(lo) ? new Date(lo).toISOString() : null,
    hi: Number.isFinite(hi) ? new Date(hi).toISOString() : null
  };
};