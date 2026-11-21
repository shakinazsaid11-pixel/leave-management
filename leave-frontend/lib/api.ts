const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// The shape every response from the API comes back in.
interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: {
    statusCode: number;
    message: string | string[];
  };
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

const SERVER_PROBLEM_MESSAGE =
  "Something went wrong on our side. Please try again in a moment.";

// Every failure leaves this file as an ApiRequestError. Its message is
// already safe to show on screen, and statusCode lets a screen react to
// particular failures (0 means the server could not be reached at all).
export class ApiRequestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiRequestError";
    this.statusCode = statusCode;
  }
}

// One place all API calls go through. Handles every failure shape:
// - the network itself failing (server down, unreachable)
// - the API answering with something that is not JSON
// - the API answering with { success: false, error: { message } }
// Callers get T on success, or a thrown ApiRequestError.
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        // Only send a content type when there is a body to describe.
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
        ...options?.headers,
      },
    });
  } catch {
    // The server is unreachable entirely (stopped, no network, etc).
    throw new ApiRequestError(
      "We couldn't reach the server. Please try again in a moment.",
      0,
    );
  }

  let body: ApiResponse<T>;
  try {
    body = await response.json();
  } catch {
    throw new ApiRequestError(SERVER_PROBLEM_MESSAGE, response.status);
  }

  if (!body.success) {
    const { statusCode, message } = body.error;

    // Server side failures never show technical wording on screen.
    if (statusCode >= 500) {
      throw new ApiRequestError(SERVER_PROBLEM_MESSAGE, statusCode);
    }

    const text = Array.isArray(message) ? message.join(" ") : message;
    throw new ApiRequestError(text, statusCode);
  }

  return body.data;
}

// ---- Types matching the API's shape ----

export interface Employee {
  employeeId: number;
  firstName: string;
  lastName: string;
  email: string;
  role: "EMPLOYEE" | "MANAGER";
  managerId: number | null;
  isActive: boolean;
}

export interface EmployeeWithBalance extends Employee {
  balanceYear: number;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
}

export type LeaveRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export interface LeaveRequest {
  requestId: number;
  employeeId: number;
  startDate: string;
  endDate: string;
  businessDays: number;
  status: LeaveRequestStatus;
  reviewerId: number | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  note: string | null;
  createdAt: string;
}

// The list endpoint also says whose request each one is.
export interface LeaveRequestWithName extends LeaveRequest {
  employeeName: string;
}

// ---- Endpoints ----

export function getEmployees(): Promise<Employee[]> {
  return apiFetch<Employee[]>("/employees");
}

export function getEmployeeWithBalance(
  employeeId: number,
): Promise<EmployeeWithBalance> {
  return apiFetch<EmployeeWithBalance>(`/employees/${employeeId}`);
}

export function getLeaveRequests(filters: {
  employeeId?: number;
  managerId?: number;
  status?: LeaveRequestStatus;
}): Promise<LeaveRequestWithName[]> {
  const params = new URLSearchParams();
  if (filters.employeeId !== undefined) {
    params.set("employeeId", String(filters.employeeId));
  }
  if (filters.managerId !== undefined) {
    params.set("managerId", String(filters.managerId));
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  const query = params.toString();
  return apiFetch<LeaveRequestWithName[]>(
    `/leave-requests${query ? `?${query}` : ""}`,
  );
}

// How many days a request would deduct. The count always comes from the
// API, so the number shown before submitting is the one that gets stored.
export function previewLeaveRequest(
  startDate: string,
  endDate: string,
): Promise<{ businessDays: number }> {
  const params = new URLSearchParams({ startDate, endDate });
  return apiFetch<{ businessDays: number }>(
    `/leave-requests/preview?${params.toString()}`,
  );
}

export function createLeaveRequest(input: {
  employeeId: number;
  startDate: string;
  endDate: string;
  note?: string;
}): Promise<LeaveRequest> {
  return apiFetch<LeaveRequest>("/leave-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function approveLeaveRequest(
  requestId: number,
  reviewerId: number,
): Promise<LeaveRequest> {
  return apiFetch<LeaveRequest>(`/leave-requests/${requestId}/approve`, {
    method: "PATCH",
    body: JSON.stringify({ reviewerId }),
  });
}

export function rejectLeaveRequest(
  requestId: number,
  reviewerId: number,
  reason: string,
): Promise<LeaveRequest> {
  return apiFetch<LeaveRequest>(`/leave-requests/${requestId}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ reviewerId, reason }),
  });
}