"use client";

import { useEffect, useRef, useState } from "react";
import { useEmployeeContext } from "@/app/context/employee-context";
import {
  LeaveRequestWithName,
  approveLeaveRequest,
  getLeaveRequests,
  rejectLeaveRequest,
} from "@/lib/api";
import { formatDate } from "@/lib/format";

const REASON_MAX_LENGTH = 255;

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-lg border border-red-400/40 bg-red-500/10 p-6 text-center"
      role="alert"
    >
      <p className="text-red-200">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-azure-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-azure-400"
      >
        Try again
      </button>
    </div>
  );
}

// Checks the cases that do not depend on the list itself, then hands over
// to ApprovalsList. The key makes React start ApprovalsList from scratch
// whenever the manager changes, so nothing from the previous manager (an
// open reason box, a message, a busy button) can carry over.
export default function ApprovalsPage() {
  const {
    employees,
    selectedEmployee,
    selectedEmployeeId,
    loading,
    error,
  } = useEmployeeContext();

  if (loading) {
    return (
      <p className="text-center text-slate-400" role="status">
        Loading...
      </p>
    );
  }

  if (error) {
    return <ErrorBox message={error} />;
  }

  if (employees.length === 0 || selectedEmployeeId === null) {
    return (
      <p className="rounded-lg border border-navy-700 bg-navy-900/60 p-6 text-center text-slate-400">
        There are no employees yet.
      </p>
    );
  }

  // Only managers have anything to approve.
  if (selectedEmployee?.role !== "MANAGER") {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-3xl font-bold text-white">Approvals</h1>
        <p className="rounded-lg border border-navy-700 bg-navy-900/60 p-6 text-slate-300">
          Only managers can review leave requests.
        </p>
      </div>
    );
  }

  return (
    <ApprovalsList
      key={selectedEmployee.employeeId}
      managerId={selectedEmployee.employeeId}
    />
  );
}

type Loaded = { requests: LeaveRequestWithName[]; error: string | null };

// A refusal, kept with the request it belongs to so it is shown on that
// request and not somewhere else on the page.
type ActionError = { requestId: number; message: string };

function ApprovalsList({ managerId }: { managerId: number }) {
  // null means the first answer has not arrived yet.
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // The request being approved or rejected right now, if any.
  const [busyId, setBusyId] = useState<number | null>(null);
  // The request whose rejection reason box is open, and what was typed.
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A state update is not instant, so a quick double click could slip a
  // second action through before the screen has re-rendered. This flag
  // changes immediately and stops that.
  const busyRef = useRef(false);
  // False once this list has left the screen, so a late answer is dropped.
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    // If this effect is replaced before the answer arrives, the old
    // answer is ignored.
    let cancelled = false;

    getLeaveRequests({ managerId, status: "PENDING" })
      .then((data) => {
        if (!cancelled) setLoaded({ requests: data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoaded({
            requests: [],
            error: err.message ?? "We could not load the requests.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [managerId]);

  // Reloads the list after an action, without the loading screen.
  async function refreshList() {
    try {
      const data = await getLeaveRequests({ managerId, status: "PENDING" });
      if (aliveRef.current) setLoaded({ requests: data, error: null });
    } catch (err) {
      if (aliveRef.current) {
        setLoaded({
          requests: [],
          error:
            err instanceof Error
              ? err.message
              : "We could not refresh the list.",
        });
      }
    }
  }

  async function runAction(
    request: LeaveRequestWithName,
    action: () => Promise<unknown>,
    successMessage: string,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(request.requestId);
    setActionError(null);
    setNotice(null);

    try {
      await action();
      setRejectingId(null);
      setReason("");
      setNotice(successMessage);
    } catch (err) {
      setActionError({
        requestId: request.requestId,
        message:
          err instanceof Error
            ? err.message
            : "We could not complete that. Please try again.",
      });
    } finally {
      // Whatever happened, show the list as it really is now.
      await refreshList();
      busyRef.current = false;
      if (aliveRef.current) setBusyId(null);
    }
  }

  function handleApprove(request: LeaveRequestWithName) {
    runAction(
      request,
      () => approveLeaveRequest(request.requestId, managerId),
      `Approved the request from ${request.employeeName}.`,
    );
  }

  function handleConfirmReject(request: LeaveRequestWithName) {
    const cleanReason = reason.trim();
    // Rejecting never goes ahead without a reason.
    if (!cleanReason) return;
    runAction(
      request,
      () => rejectLeaveRequest(request.requestId, managerId, cleanReason),
      `Rejected the request from ${request.employeeName}.`,
    );
  }

  function openRejectBox(requestId: number) {
    setRejectingId(requestId);
    setReason("");
    setActionError(null);
    setNotice(null);
  }

  if (loaded === null) {
    return (
      <p className="text-center text-slate-400" role="status">
        Loading the requests waiting for you...
      </p>
    );
  }

  if (loaded.error) {
    return <ErrorBox message={loaded.error} />;
  }

  const requests = loaded.requests;
  const anyBusy = busyId !== null;

  return (
    <div className="flex flex-col gap-8">
      <section className="text-center">
        <h1 className="text-3xl font-bold text-white">Approvals</h1>
        <p className="mt-3 text-slate-300">
          {requests.length === 0
            ? "Nothing is waiting for your approval."
            : `${requests.length} request${requests.length === 1 ? " is" : "s are"} waiting for your decision.`}
        </p>
      </section>

      <div aria-live="polite">
        {notice && (
          <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-center text-sm text-emerald-200">
            {notice}
          </p>
        )}
      </div>

      {requests.length === 0 ? (
        <p className="rounded-lg border border-navy-700 bg-navy-900/60 p-6 text-center text-slate-400">
          When someone on your team asks for leave, it will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {requests.map((request) => {
            const isBusy = busyId === request.requestId;
            const isRejecting = rejectingId === request.requestId;
            const refusal =
              actionError?.requestId === request.requestId
                ? actionError.message
                : null;

            return (
              <li
                key={request.requestId}
                className="rounded-xl border border-navy-700 bg-navy-900/60 p-5 transition-colors hover:border-azure-500/60"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-lg font-semibold text-white">
                      {request.employeeName}
                    </p>
                    <p className="text-sm text-slate-300">
                      From {formatDate(request.startDate)} to{" "}
                      {formatDate(request.endDate)}
                    </p>
                    <p className="text-sm text-slate-300">
                      <span className="font-semibold text-azure-400">
                        {request.businessDays}
                      </span>{" "}
                      working day{request.businessDays === 1 ? "" : "s"}
                    </p>
                    {request.note && (
                      <p className="mt-1 text-sm text-slate-400">
                        Note: {request.note}
                      </p>
                    )}
                  </div>

                  {!isRejecting && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleApprove(request)}
                        disabled={anyBusy}
                        className="select-none rounded-lg bg-azure-500 px-4 py-2 text-sm font-semibold text-white transition-colors enabled:hover:bg-azure-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? "Approving..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openRejectBox(request.requestId)}
                        disabled={anyBusy}
                        className="select-none rounded-lg border border-red-400/60 px-4 py-2 text-sm font-semibold text-red-300 transition-colors enabled:hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {isRejecting && (
                  <div className="mt-4 flex flex-col gap-3 border-t border-navy-700 pt-4">
                    <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                      <span className="flex items-baseline justify-between">
                        <span>Reason for rejecting</span>
                        <span className="text-xs font-normal text-slate-400">
                          {reason.length}/{REASON_MAX_LENGTH}
                        </span>
                      </span>
                      <textarea
                        rows={2}
                        maxLength={REASON_MAX_LENGTH}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        disabled={isBusy}
                        placeholder="Tell them why, so they know what to change"
                        className="w-full resize-none rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-white transition-colors hover:border-azure-500 focus:border-azure-500 focus:outline-none focus:ring-2 focus:ring-azure-500/40 disabled:opacity-60"
                      />
                    </label>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setRejectingId(null)}
                        disabled={anyBusy}
                        className="select-none rounded-lg border border-navy-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors enabled:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Go back
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmReject(request)}
                        disabled={anyBusy || reason.trim().length === 0}
                        className="select-none rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors enabled:hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? "Rejecting..." : "Confirm rejection"}
                      </button>
                    </div>
                  </div>
                )}

                {refusal && (
                  <p
                    className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-center text-sm text-red-200"
                    role="alert"
                  >
                    {refusal}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}