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

const UTC_PLUS_3_MS = 3 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// The API sends date-only values as "YYYY-MM-DD" strings (no time
// component). Parsing that through `new Date(...)` and then reading it
// back with local-timezone methods can shift the displayed day by one,
// depending on the browser's timezone offset. A date-only value has no
// moment to convert, so the parts are read straight off the string and a
// Date object is never built from it.
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

// For timestamps that DO have a real moment in time (reviewedAt,
// createdAt). These come back as full ISO strings in UTC and are shown in
// UTC+3. Three hours are added to the moment first, and then the date and
// the time are both read from that shifted value, so a time just after
// midnight in UTC+3 shows the right day as well as the right hour.
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";

  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return "Not available";

  const shifted = new Date(moment.getTime() + UTC_PLUS_3_MS);
  const datePart = `${pad(shifted.getUTCDate())}-${MONTHS[shifted.getUTCMonth()]}-${String(shifted.getUTCFullYear()).slice(-2)}`;
  const timePart = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;

  return `${datePart} ${timePart}`;
}