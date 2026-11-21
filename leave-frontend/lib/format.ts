const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// The API sends date-only values as "YYYY-MM-DD" strings (no time
// component). A date has no hour and no timezone, so it must never be
// converted. Parsing it through `new Date(...)` and reading it back with
// local-timezone methods can shift the day by one, so the parts are read
// straight off the string and a Date object is never built from it.
//
// If the value is missing or is not a real date, a plain sentence is
// shown instead of "NaN" or "undefined".
export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not available";

  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !day || !month || month < 1 || month > 12) {
    return "Not available";
  }

  return `${pad(day)}-${MONTHS[month - 1]}-${String(year).slice(-2)}`;
}

// A moment, like "approved at", is one instant in the world, stored in UTC.
// It is shown in a real named timezone, not a fixed number of hours, so it
// follows Egypt's clock changes. The month is read as a number and named
// from MONTHS, because the browser's own short month names differ
// between versions (for example "Sept" and "Sep").
const cairoFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Cairo",
  day: "2-digit",
  month: "numeric",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";

  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return "Not available";

  const parts = Object.fromEntries(
    cairoFormatter.formatToParts(moment).map((part) => [part.type, part.value]),
  );

  return `${parts.day}-${MONTHS[Number(parts.month) - 1]}-${parts.year} ${parts.hour}:${parts.minute}`;
}