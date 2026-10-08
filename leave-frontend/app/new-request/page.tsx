"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useEmployeeContext } from "@/app/context/employee-context";
import { createLeaveRequest, previewLeaveRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";

const NOTE_MAX_LENGTH = 500;

// What the form knows about the day count. It always comes from the API,
// never from a second copy of the counting rules in the browser.
type Preview =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; days: number }
  | { state: "error"; message: string };

// Today as yyyy-mm-dd, built from the local date parts so it never
// shifts a day the way toISOString would. Only used as a hint on the
// date picker; the API makes the real decision.
function todayAsInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

const inputStyle =
  "w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-white transition-colors [color-scheme:dark] hover:border-azure-500 focus:border-azure-500 focus:outline-none focus:ring-2 focus:ring-azure-500/40";

export default function NewRequestPage() {
  const router = useRouter();
  const { employees, selectedEmployee, selectedEmployeeId, loading, error } =
    useEmployeeContext();

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview>({ state: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Ask the API how many days these dates would use, every time they change.
  useEffect(() => {
    if (!startDate || !endDate) {
      setPreview({ state: "idle" });
      return;
    }

    // If the dates change again before the answer arrives, ignore the
    // old answer so the screen never shows a number for the wrong dates.
    let cancelled = false;
    setPreview({ state: "loading" });

    previewLeaveRequest(startDate, endDate)
      .then((result) => {
        if (!cancelled) {
          setPreview({ state: "ready", days: result.businessDays });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPreview({
            state: "error",
            message: err.message ?? "We could not check these dates.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second click while the first is still travelling does nothing.
    if (submitting || selectedEmployeeId === null) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      await createLeaveRequest({
        employeeId: selectedEmployeeId,
        startDate,
        endDate,
        note: note.trim() || undefined,
      });
      router.push("/");
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "We could not send your request. Please try again.",
      );
      setSubmitting(false);
    }
  }

  // The list of people is still on its way.
  if (loading) {
    return (
      <p className="text-center text-slate-400" role="status">
        Loading...
      </p>
    );
  }

  // The list of people could not be loaded.
  if (error) {
    return (
      <p
        className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-center text-red-200"
        role="alert"
      >
        {error}
      </p>
    );
  }

  // Nobody to submit a request for.
  if (employees.length === 0 || selectedEmployeeId === null) {
    return (
      <p className="rounded-lg border border-navy-700 bg-navy-900/60 p-6 text-center text-slate-400">
        There are no employees to submit a request for yet.
      </p>
    );
  }

  const canSubmit = preview.state === "ready" && !submitting;

  return (
    <div className="flex flex-col gap-8">
      <section className="text-center">
        <h1 className="text-3xl font-bold text-white">New request</h1>
        <p className="mt-3 text-slate-300">
          Choose your dates. We show how many days will be deducted before you
          submit.
        </p>
        {selectedEmployee && (
          <p className="mt-1 text-sm text-slate-400">
            Requesting for {selectedEmployee.firstName}{" "}
            {selectedEmployee.lastName}
          </p>
        )}
      </section>

      <form
        onSubmit={handleSubmit}
        className="mx-auto flex w-full max-w-lg flex-col gap-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
            Start date
            <input
              type="date"
              required
              min={todayAsInputValue()}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputStyle}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
            End date
            <input
              type="date"
              required
              min={startDate || todayAsInputValue()}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputStyle}
            />
          </label>
        </div>

        <div
          className="min-h-14 rounded-lg border border-navy-700 bg-navy-900/60 p-4 text-center text-sm"
          aria-live="polite"
        >
          {preview.state === "idle" && (
            <span className="text-slate-400">
              Choose both dates to see how many days will be deducted.
            </span>
          )}
          {preview.state === "loading" && (
            <span className="text-slate-400">Counting working days...</span>
          )}
          {preview.state === "ready" && (
            <span className="text-slate-300">
              From {formatDate(startDate)} to {formatDate(endDate)} uses{" "}
              <span className="text-xl font-bold text-azure-400">
                {preview.days}
              </span>{" "}
              working day{preview.days === 1 ? "" : "s"}.
            </span>
          )}
          {preview.state === "error" && (
            <span className="text-amber-300" role="alert">
              {preview.message}
            </span>
          )}
        </div>

        <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
          <span className="flex items-baseline justify-between">
            <span>Note (optional)</span>
            <span className="text-xs font-normal text-slate-400">
              {note.length}/{NOTE_MAX_LENGTH}
            </span>
          </span>
          <textarea
            rows={3}
            maxLength={NOTE_MAX_LENGTH}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything your manager should know"
            className={`${inputStyle} resize-none`}
          />
        </label>

        {submitError && (
          <p
            className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-center text-sm text-red-200"
            role="alert"
          >
            {submitError}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-azure-500 px-4 py-3 font-semibold text-white transition-colors enabled:hover:bg-azure-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Sending your request..." : "Submit request"}
        </button>
      </form>
    </div>
  );
}