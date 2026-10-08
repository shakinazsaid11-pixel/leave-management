"use client";

import { useEffect, useState } from "react";
import { useEmployeeContext } from "@/app/context/employee-context";
import {
  EmployeeWithBalance,
  LeaveRequest,
  getEmployeeWithBalance,
  getLeaveRequests,
} from "@/lib/api";
import { formatDate } from "@/lib/format";

export default function MyRequestsPage() {
  const { selectedEmployeeId } = useEmployeeContext();

  const [balance, setBalance] = useState<EmployeeWithBalance | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedEmployeeId === null) return;

    setLoading(true);
    setError(null);

    Promise.all([
      getEmployeeWithBalance(selectedEmployeeId),
      getLeaveRequests({ employeeId: selectedEmployeeId }),
    ])
      .then(([balanceData, requestsData]) => {
        setBalance(balanceData);
        setRequests(requestsData);
      })
      .catch((err) => {
        setError(err.message ?? "We could not load your requests.");
      })
      .finally(() => setLoading(false));
  }, [selectedEmployeeId]);

  // The employee list itself is still loading. The selector already
  // shows its own loading state, so this page has nothing useful to say yet.
  if (selectedEmployeeId === null) {
    return null;
  }

  if (loading) {
    return (
      <p className="text-center text-slate-400" role="status">
        Loading your requests...
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

  return (
    <div className="flex flex-col gap-8">
      <section className="text-center">
        <h1 className="text-3xl font-bold text-white">My requests</h1>
        {balance && (
          <p className="mt-3 text-slate-300">
            You have{" "}
            <span className="text-2xl font-bold text-azure-400">
              {balance.remainingDays}
            </span>{" "}
            day{balance.remainingDays === 1 ? "" : "s"} remaining out of{" "}
            {balance.totalDays} for {balance.balanceYear}.
          </p>
        )}
      </section>

      <section>
        {requests.length === 0 ? (
          <p className="rounded-lg border border-navy-700 bg-navy-900/60 p-6 text-center text-slate-400">
            You have not submitted any leave requests yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-navy-700">
            <table className="w-full border-collapse text-center text-sm">
              <thead>
                <tr className="bg-navy-900/60 text-xs uppercase tracking-wide text-azure-300">
                  <th className="px-4 py-3">Start date</th>
                  <th className="px-4 py-3">End date</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr
                    key={request.requestId}
                    className="border-t border-navy-700 transition-colors hover:bg-azure-500/10"
                  >
                    <td className="px-4 py-3">
                      {formatDate(request.startDate)}
                    </td>
                    <td className="px-4 py-3">{formatDate(request.endDate)}</td>
                    <td className="px-4 py-3">{request.businessDays}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(request.status)}`}
                      >
                        {statusLabel(request.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {request.status === "REJECTED" && request.rejectionReason
                        ? request.rejectionReason
                        : "None"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function statusLabel(status: LeaveRequest["status"]): string {
  switch (status) {
    case "PENDING":
      return "Waiting for approval";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
  }
}

function statusStyle(status: LeaveRequest["status"]): string {
  switch (status) {
    case "PENDING":
      return "bg-amber-400/15 text-amber-300";
    case "APPROVED":
      return "bg-emerald-400/15 text-emerald-300";
    case "REJECTED":
      return "bg-red-400/15 text-red-300";
    case "CANCELLED":
      return "bg-slate-400/15 text-slate-300";
  }
}