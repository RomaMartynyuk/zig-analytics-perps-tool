const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function getTimeZoneOffset(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, Number(parts.month) - 1, parts.day, parts.hour, parts.minute);
  return asUtc - date.getTime();
}

function zonedDateToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - getTimeZoneOffset(guess, timeZone));
}

function parseTime(value) {
  const [hour = '0', minute = '0'] = String(value || '00:00').split(':');
  const hours = Number(hour);
  const minutes = Number(minute);
  return Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? { hours, minutes }
    : null;
}

export function getRecurringSnapshot(project, now = new Date()) {
  const schedule = project.points_snapshot;
  if (!schedule) return null;

  const targetWeekday = WEEKDAYS[String(schedule.weekday).toLowerCase()];
  const time = parseTime(schedule.time);
  const timeZone = schedule.timezone || 'UTC';
  if (targetWeekday == null || !time) return null;

  const localNow = getZonedParts(now, timeZone);
  const currentWeekday = WEEKDAYS[localNow.weekday.toLowerCase()];
  const currentLocalDate = new Date(Date.UTC(localNow.year, Number(localNow.month) - 1, localNow.day));
  let daysUntil = (targetWeekday - currentWeekday + 7) % 7;
  let candidateLocalDate = new Date(currentLocalDate);
  candidateLocalDate.setUTCDate(candidateLocalDate.getUTCDate() + daysUntil);

  let scheduledAt = zonedDateToUtc(
    candidateLocalDate.getUTCFullYear(),
    candidateLocalDate.getUTCMonth() + 1,
    candidateLocalDate.getUTCDate(),
    time.hours,
    time.minutes,
    timeZone
  );

  if (now >= scheduledAt) {
    const pointsDayEndsAt = new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000);
    if (now < pointsDayEndsAt) {
      return { ...project, isPointsDay: true, endsAt: pointsDayEndsAt };
    }

    candidateLocalDate.setUTCDate(candidateLocalDate.getUTCDate() + 7);
    scheduledAt = zonedDateToUtc(
      candidateLocalDate.getUTCFullYear(),
      candidateLocalDate.getUTCMonth() + 1,
      candidateLocalDate.getUTCDate(),
      time.hours,
      time.minutes,
      timeZone
    );
  }

  return { ...project, isPointsDay: false, scheduledAt };
}

export function formatCountdown(targetDate, now = new Date()) {
  const remainingSeconds = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 1000));
  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  return `${String(days).padStart(2, '0')}d:${String(hours).padStart(2, '0')}h:${String(minutes).padStart(2, '0')}m`;
}
