# LOG

## Week 1 — data model

### Entities found in the brief

- **Employee** — id, first name, last name, email, role (employee/manager), their manager (another employee, optional), whether they're still active. Every employee reports to at most one manager, and a manager is also an employee, so this is a self-referencing relationship rather than a separate "manager" table.
- **Leave request** — id, who submitted it, start date, end date, status (pending/approved/rejected/cancelled), who reviewed it, when, and a rejection reason when applicable.
- **Leave balance** (not named explicitly in the brief, but implied by "21 days per year" and "how many days an employee has left") — how many days an employee is entitled to, per year.

### What I built

- Schema with `EMPLOYEE`, `LEAVE_BALANCE`, `LEAVE_REQUEST`.
- Constraints doing as much of the enforcement as Postgres can do on its own: `CHECK` on status values, `CHECK` on date ordering, `CHECK` on start date not being in the past, a `GIST EXCLUDE` constraint stopping two approved requests for the same employee from overlapping, and a trigger stopping an approval from pushing someone over their yearly balance.
- Seed data: 10 employees, 3 managers, 45 leave requests across all four statuses and every month of the year, loaded and verified against a real Postgres instance (not just eyeballed) — the overlap constraint and the balance trigger both actually ran against every row.
- `docker-compose.yml` that brings the whole thing up with one command using Postgres's own init-script mechanism, rather than a custom entrypoint script.

### What confused me, and what I decided

**Where does the 21 days live?** I went back and forth between a stored running balance (a `used_days` counter on the employee, decremented on approval) and a fully calculated balance (sum approved requests on demand). I went with **calculated**, backed by a `leave_balance(employee_id, year)` table that only stores the *entitlement*, not the usage. Reasoning: a stored counter is a second copy of information that already exists in `leave_request` — it can drift out of sync with reality, and I'd rather have one source of truth even at the cost of an aggregate query.

Splitting it into a per-year table was really about the Dec 30 → Jan 3 question: I decided a request is charged against the year of its **start date**, in full. I'm flagging this as an assumption to confirm on the call, not a settled fact.

**Do weekends affect the database design, or is that someone else's problem?** I decided it's partly the database's problem. Storing the computed `business_days` value at submission time means the definition of a weekend only needs to be applied once. Trade-off: if the weekend policy changes, already-approved requests keep their old count — I think that's correct, but it's worth saying out loud.

**What stops the database from accepting `end_date < start_date` on its own?** A plain `CHECK (end_date >= start_date)`.

**Reviewer for the one employee with no manager.** Still an open gap in the business rules — flagged for the call.

### Questions I'm bringing to the call

- Confirm the "request charged to the year of its start_date" assumption for New Year's-spanning leave.
- Who reviews the request of an employee who has no manager?
- Is a calculated balance the right trade-off once this scales past ~200 employees?

---

## Week 2 — the API

Built the NestJS/TypeORM backend on top of the week-1 schema: all 8 endpoints (`GET /employees`, `GET /employees/:id`, `POST /leave-requests`, `GET /leave-requests` with filtering, `GET /leave-requests/:id`, and the three `PATCH .../approve|reject|cancel` transitions).

### What I built

- **`EmployeesModule`** — entity + service + controller. The remaining-balance calculation (entitlement minus approved days for the year) lives in the service, since it's a business rule that combines two tables, not a query.
- **`LeaveRequestsModule`** — entity + service + controller for the full leave-request lifecycle. Business-day counting (excluding weekends) happens in `create()`, computed from `startDate`/`endDate` rather than trusted from the client — the client shouldn't be the one deciding how many days a request costs.
- **Status-transition rules in the service**: only a `PENDING` request can move to `APPROVED`/`REJECTED`/`CANCELLED`; trying to act on a request that's already been decided returns a clear error instead of silently succeeding or throwing a raw DB error.
- **A response interceptor** wraps every successful response as `{ "success": true, "data": ... }`.
- **A Postman collection** (kept as local `.yaml` files via "Work locally with Git", not a single exported JSON) covering all 8 endpoints plus a few deliberately-broken cases: employee not found, leave request not found, filtering by employee and by status.

### A real bug I hit, and what it taught me

My first `POST /leave-requests` attempt failed with `Cannot read properties of undefined (reading 'employeeId')`, followed by a Postgres `null value in column "business_days"` error. The cause: I'd written `create()` to expect `businessDays` as part of the incoming request body, but the DTO never had that field — the client only ever sends `employeeId`/`startDate`/`endDate`. The fix was to compute `businessDays` inside the service from the two dates, which is also just the more correct design: that calculation is business logic, and the client asking for leave shouldn't need to know or care how the server counts business days.

### Known gaps I'm not hiding from the call

- **Response shape is inconsistent.** Success responses are wrapped (`{ success, data }`); errors still come back in NestJS's default shape. I ran out of time to write the matching exception filter before this log entry. This directly matters for one of the assignment's own questions ("what does the body say for a 404") — right now the honest answer is "it depends whether it succeeded or failed," which isn't the intent.
- **No dedicated Repository class.** Services inject TypeORM's `Repository<T>` directly rather than going through a repository layer that's the only place allowed to build queries. `LeaveRequestsService.findAll` builds its own `createQueryBuilder` chain for the filters, which is arguably query-building logic that belongs one layer down.
- **Past-start-date requests** currently surface as a raw Postgres constraint violation rather than a clean validation error — the same category of problem as the response-shape issue, just not yet caught before the database sees it.

