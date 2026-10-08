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

export default function ApprovalsPage() {
  const {
    employees,
    selectedEmployee,
    selectedEmployeeId,
    loading: employeesLoading,
    error: employeesError,
  } = useEmployeeContext();

  // Only managers have anything to approve.
  const managerId =
    selectedEmployee?.role === "MANAGER" ? selectedEmployee.employeeId : null;

  const [requests, setRequests] = useState<LeaveRequestWithName[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The request being approved or rejected right now, if any.
  const [busyId, setBusyId] = useState<number | null>(null);
  // The request whose rejection reason box is open, and what was typed.
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A state update is not instant, so a quick double click could slip a
  // second action through before the screen has re-rendered. This flag
  // changes immediately and stops that.
  const busyRef = useRef(false);
  // Which manager's list is on screen, so a slow answer for someone the
  // user has already switched away from is ignored.
  const latestManagerId = useRef<number | null>(null);

  useEffect(() => {
    latestManagerId.current = managerId;
    setRejectingId(null);
    setReason("");
    setActionError(null);
    setNotice(null);

    if (managerId === null) {
      setRequests([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getLeaveRequests({ managerId, status: "PENDING" })
      .then((data) => {
        if (!cancelled) setRequests(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "We could not load the requests.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [managerId]);

  // Reloads the list quietly after an action, without the loading screen.
  async function refreshList() {
    const id = managerId;
    if (id === null) return;
    try {
      const data = await getLeaveRequests({
        managerId: id,
        status: "PENDING",
      });
      if (latestManagerId.current === id) setRequests(data);
    } catch (err) {
      if (latestManagerId.current === id) {
        setError(
          err instanceof Error
            ? err.message
            : "We could not refresh the list.",
        );
      }
    }
  }

  async function runAction(
    request: LeaveRequestWithName,
    action: () => Promise<unknown>,
    successMessage: string,
  ) {
    if (busyRef.current || managerId === null) return;
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
      setActionError(
        err instanceof Error
          ? err.message
          : "We could not complete that. Please try again.",
      );
    } finally {
      // Whatever happened, show the list as it really is now.
      await refreshList();
      busyRef.current = false;
      setBusyId(null);
    }
  }

  function handleApprove(request: LeaveRequestWithName) {
    if (managerId === null) return;
    runAction(
      request,
      () => approveLeaveRequest(request.requestId, managerId),
      `Approved the request from ${request.employeeName}.`,
    );
  }

  function handleConfirmReject(request: LeaveRequestWithName) {
    const cleanReason = reason.trim();
    // Rejecting never goes ahead without a reason.
    if (managerId === null || !cleanReason) return;
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

  // The list of people is still on its way.
  if (employeesLoading) {
    return (
      <p className="text-center text-slate-400" role="status">
        Loading...
      </p>
    );
  }

  // The list of people could not be loaded.
  if (employeesError) {
    return (
      <p
        className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-center text-red-200"
        role="alert"
      >
        {employeesError}
      </p>
    );
  }

  if (employees.length === 0 || selectedEmployeeId === null) {
    return (
      <p className="rounded-lg border border-navy-700 bg-navy-900/60 p-6 text-center text-slate-400">
        There are no employees yet.
      </p>
    );
  }

  // The chosen person is not a manager.
  if (managerId === null) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-3xl font-bold text-white">Approvals</h1>
        <p className="rounded-lg border border-navy-700 bg-navy-900/60 p-6 text-slate-300">
          Only managers can review leave requests. Choose a manager from the
          menu at the top to see what is waiting for them.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <p className="text-center text-slate-400" role="status">
        Loading the requests waiting for you...
      </p>
    );
  }

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

      <div aria-live="polite" className="flex flex-col gap-3">
        {notice && (
          <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-center text-sm text-emerald-200">
            {notice}
          </p>
        )}
        {actionError && (
          <p
            className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-center text-sm text-red-200"
            role="alert"
          >
            {actionError}
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
                        className="rounded-lg bg-azure-500 px-4 py-2 text-sm font-semibold text-white transition-colors enabled:hover:bg-azure-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? "Approving..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openRejectBox(request.requestId)}
                        disabled={anyBusy}
                        className="rounded-lg border border-red-400/60 px-4 py-2 text-sm font-semibold text-red-300 transition-colors enabled:hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
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
                        className="rounded-lg border border-navy-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors enabled:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Go back
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmReject(request)}
                        disabled={anyBusy || reason.trim().length === 0}
                        className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors enabled:hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? "Rejecting..." : "Confirm rejection"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}