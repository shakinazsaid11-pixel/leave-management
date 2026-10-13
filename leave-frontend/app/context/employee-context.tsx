"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { Employee, getEmployees } from "@/lib/api";

interface EmployeeContextValue {
  employees: Employee[];
  selectedEmployeeId: number | null;
  setSelectedEmployeeId: (id: number) => void;
  selectedEmployee: Employee | null;
  loading: boolean;
  error: string | null;
}

const EmployeeContext = createContext<EmployeeContextValue | null>(null);

// Wraps the whole app. Fetches the employee list once, and remembers
// which one is "selected" while the person navigates between pages —
// this stands in for real login until week 5.
export function EmployeeProvider({ children }: { children: ReactNode }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEmployees()
      .then((list) => {
        setEmployees(list);
        if (list.length > 0) {
          setSelectedEmployeeId(list[0].employeeId);
        }
      })
      .catch((err) => {
        setError(err.message ?? "We couldn't load the employee list.");
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedEmployee =
    employees.find((e) => e.employeeId === selectedEmployeeId) ?? null;

  return (
    <EmployeeContext.Provider
      value={{
        employees,
        selectedEmployeeId,
        setSelectedEmployeeId,
        selectedEmployee,
        loading,
        error,
      }}
    >
      {children}
    </EmployeeContext.Provider>
  );
}

export function useEmployeeContext(): EmployeeContextValue {
  const context = useContext(EmployeeContext);
  if (!context) {
    throw new Error(
      "useEmployeeContext must be used inside an EmployeeProvider",
    );
  }
  return context;
}