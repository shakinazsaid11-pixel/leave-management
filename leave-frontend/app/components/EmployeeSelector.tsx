"use client";

import { useEmployeeContext } from "@/app/context/employee-context";

// The dropdown at the top of every page. It stands in for a real login
// until week 5, so someone can switch between people while testing.
export default function EmployeeSelector() {
  const {
    employees,
    selectedEmployee,
    selectedEmployeeId,
    setSelectedEmployeeId,
    loading,
    error,
  } = useEmployeeContext();

  if (loading) {
    return (
      <div className="text-sm text-slate-400" role="status">
        Loading people...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm font-medium text-red-300" role="alert">
        {error}
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="text-sm text-slate-400">
        There are no employees to choose from yet.
      </div>
    );
  }

  // Two letters for the circle, taken from the chosen person's name.
  const initials = selectedEmployee
    ? `${selectedEmployee.firstName[0] ?? ""}${selectedEmployee.lastName[0] ?? ""}`.toUpperCase()
    : "";

  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full bg-azure-500 text-xs font-bold text-white"
        aria-hidden="true"
      >
        {initials}
      </span>
      <select
        aria-label="Choose which employee to use the app as"
        className="cursor-pointer rounded-full border border-navy-700 bg-navy-800 px-4 py-2 text-sm text-white transition-colors hover:border-azure-500 focus:border-azure-500 focus:outline-none focus:ring-2 focus:ring-azure-500/40"
        value={selectedEmployeeId ?? ""}
        onChange={(e) => setSelectedEmployeeId(Number(e.target.value))}
      >
        {employees.map((employee) => (
          <option key={employee.employeeId} value={employee.employeeId}>
            {employee.firstName} {employee.lastName}
            {employee.role === "MANAGER" ? " (Manager)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}