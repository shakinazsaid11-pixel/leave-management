# Leave Management System

Leave management system built with NestJS, TypeORM, PostgreSQL and a Next.js frontend.

## Project Structure

```text
leave-management/
├── db/
├── docs/
├── leave-api/
├── leave-frontend/
└── docker-compose.yml
```

- `leave-api/` — NestJS backend API
- `leave-frontend/` — Next.js user interface
- `db/` — PostgreSQL schema and seed data
- `docs/` — ER diagram and documentation
- `docker-compose.yml` — PostgreSQL container setup

---

## Requirements

- Node.js
- npm
- Docker Desktop
- PostgreSQL (provided through Docker)

---

## Setup

### 1. Start the database

From the project root:

```bash
docker compose up -d
```

To reset the database and reload the schema and seed data:

```bash
docker compose down -v
docker compose up -d
```

### 2. Configure environment variables

Go to the API directory:

```bash
cd leave-api
```

Copy `.env.example` to `.env` — the defaults already match `docker-compose.yml`:

```bash
cp .env.example .env
```

The `.env` file is local configuration and should not be committed to the repository.

### 3. Install dependencies

Inside `leave-api`:

```bash
npm install
```

### 4. Run the API

For development:

```bash
npm run start:dev
```

To run normally:

```bash
npm run start
```

To build the application:

```bash
npm run build
```

The API runs on the port configured in `.env` (`http://localhost:3000` by default).

### 5. Run the frontend

The API must already be running (it uses port 3000), so the frontend runs on port 3001.

From the project root:

```bash
cd leave-frontend
npm install
```

Create a file named `.env.local` inside `leave-frontend` (next to `package.json`) with the address of the API:

```text
NEXT_PUBLIC_API_URL=http://localhost:3000
```

`.env.example` in the same folder shows the same line. `.env.local` is local configuration and should not be committed.

Start it:

```bash
npm run dev -- -p 3001
```

Then open `http://localhost:3001`. There is no login yet, so the menu at the top right switches between people while testing.

---

## Available Scripts

API (`leave-api`):

```bash
npm run build
npm run start
npm run start:dev
npm run start:debug
npm run start:prod
npm run format
npm run lint
npm run test
npm run test:watch
npm run test:cov
npm run test:e2e
```

Frontend (`leave-frontend`):

```bash
npm run dev -- -p 3001
npm run build
npm run start
npm run lint
```

---

## Database

The project uses PostgreSQL 16, run through `docker-compose.yml`.

```bash
docker compose up -d
```

The database schema and seed data are loaded automatically on the **first** run only (Postgres runs anything in `/docker-entrypoint-initdb.d/` once, when the data volume is empty).

To connect to PostgreSQL directly:

```bash
docker exec -it leave-management-db psql -U postgres -d postgres
```

To completely reset the database (re-run schema + seed):

```bash
docker compose down -v
docker compose up -d
```

---

## Week 1 — Database Design

The database contains:

- Employees and managers
- Leave requests
- Leave balances
- Review information
- Soft deletion using `is_active`

Important database design decisions:

- Remaining leave balance is calculated from the source data, not stored as a running counter.
- Friday and Saturday are excluded when calculating business days.
- `start_date` and `end_date` use `DATE`.
- Timestamp columns use `TIMESTAMPTZ`.
- The rule that a leave request cannot start in the past is enforced only in the application layer (`LeaveRequestsService.create`) — the equivalent database `CHECK` constraint is commented out in `schema.sql`, since a schema shouldn't refuse to store leave that genuinely happened in the past (history, migrations, reporting).
- Approved leave overlap is prevented at the database level (a `GIST EXCLUDE` constraint) **and** re-checked in the application layer for the same reason.
- Balance enforcement is backed by a database trigger, with the same check duplicated in the service for a clean error message.
- Cancelling an approved request keeps its review history — `reviewerId`/`reviewedAt` are never cleared, even when a manager later cancels an approved request.

---

## Week 3 — Validation

Every rule below is enforced in the **service layer**, before the database is ever asked. The database still holds its own constraints (from week 1) as a safety net, but the caller should almost always be stopped by the API first with a message they can actually understand.

| # | Rule | Status | Message |
|---|---|---:|---|
| 1 | End date is before start date | 400 | `The end date cannot be before the start date.` |
| 2 | Start date is in the past | 400 | `The start date cannot be in the past.` |
| 3 | Requested days exceed remaining balance | 400 | `This employee has X day(s) left and this request needs Y day(s).` |
| 4 | Dates overlap an existing approved request | 409 | `This request overlaps approved leave from dd-MMM-yy to dd-MMM-yy.` |
| 5 | Employee does not exist | 400 | `We could not find this employee.` |
| 6 | Rejection submitted without a reason | 400 | `Please give a reason for rejecting this request.` |
| 7 | Approved request cancelled by the employee (not their manager) | 403 | `Only the employee's manager can cancel an approved request.` |
| 8 | Request is no longer pending, reviewed or cancelled again | 400 | `This request is no longer waiting for review, so it cannot be approved.` (same wording for reject, and a matching one for cancel) |

### 1. Invalid date range

The end date cannot be before the start date. Checked in `LeaveRequestsService.create`, before anything else.

### 2. Past start date

A new leave request cannot start in the past. Checked in `LeaveRequestsService.create`, right after rule 1 — compared against the start of today (not the current moment), so a request starting today is allowed rather than refused.

### 3. Remaining balance

Per the business brief, the balance is only checked **at approval time**, not at submission — a request can be *submitted* for more days than the employee has left, but it can't be *approved*. Checked in `LeaveRequestsService.approve`.

Friday and Saturday are excluded when calculating business days:

```text
Thursday → Friday → Saturday → Sunday
   1          -        -          1

Total = 2 business days
```

### 4. Overlapping approved leave

A request can't be approved if its date range shares even one day with another `APPROVED` request for the same employee. Checked in `LeaveRequestsService.approve`, using a single condition (`existing.endDate >= new.startDate AND existing.startDate <= new.endDate`) that covers every way two date ranges can overlap, rather than a separate check per case. Both end dates count as part of the leave (inclusive on both ends).

The final backstop against a true concurrent-approval race (two managers approving two overlapping requests for the same employee at the same instant) is the week-1 `GIST EXCLUDE` constraint, enforced by Postgres itself — a single service-layer check running twice in parallel can't fully close that gap on its own.

### 5. Employee existence

A leave request cannot be submitted for an employee who does not exist. Checked in `LeaveRequestsService.create`, after the date checks and before the request is saved.

### 6. Rejection reason

Rejecting a leave request requires a rejection reason (spaces only do not count, and the reason is limited to 255 characters). Checked in `LeaveRequestsService.reject`.

### 7. Cancellation authorization

A `PENDING` request can be cancelled by the employee. An `APPROVED` request can only be cancelled by the employee's manager. There's no login yet, so the caller currently identifies themselves by passing `requesterId` in the body; the service checks that `requesterId` matches the employee's `managerId`. This is a placeholder until week 5 introduces real authentication.

### 8. Request status

A leave request that has already been approved, rejected, or cancelled cannot be approved (or rejected, or cancelled) again — only a `PENDING` request can change status. Checked in `approve`, `reject`, and `cancel`.

---

## Week 4 — User interface and input checks

### Screens

- **My requests** — remaining balance for the year and a table of the person's own requests (dates, days, status, rejection reason).
- **New request** — start date, end date and an optional note. The number of days that will be deducted comes from the API before submitting, and a refusal from the API is shown next to the form.
- **Approvals** — for managers: the requests waiting on their team, each with an approve and a reject button. Rejecting asks for a reason and cannot go ahead without one.

Every screen handles four states: loading, empty, error (for example the API is stopped) and loaded. No data is written into the pages; everything comes from the API.

### API changes made for the screens

| Change | Why |
|---|---|
| `note` field on a request (entity, DTO, service) | The new request form has an optional note |
| `GET /leave-requests/preview?startDate=&endDate=` | The form shows the days to be deducted. It uses the same function as `POST /leave-requests`, so the two can never disagree |
| `managerId` filter and `employeeName` on `GET /leave-requests` | The approvals screen needs the manager's team and the names |
| Requests and employees returned in a fixed order | Lists look the same every time |
| `totalDays`, `usedDays`, `remainingDays`, `balanceYear` on `GET /employees/:id` | The balance shown on My requests |

### Input checks

Input is checked before the service or the database is asked, using `ValidationPipe` and class-validator on the DTOs:

| Input | Status | Message |
|---|---:|---|
| Missing or invalid date | 400 | `Please enter the start date as a valid date.` (or end date) |
| Note longer than 500 characters | 400 | `The note can be at most 500 characters.` |
| Only Friday and Saturday chosen | 400 | `The dates you chose have no working days. Please choose at least one day from Sunday to Thursday.` |
| Reviewer missing or unknown | 400 | `Please choose who is reviewing this request.` |
| Rejection reason empty or only spaces | 400 | `Please give a reason for rejecting this request.` |

### Error logging

`AllExceptionsFilter` writes every failure to the server log with the method, the URL and the status. Unexpected failures are logged as errors with the full stack trace, and expected refusals (400 to 499) as warnings. Database rule violations (overlap, balance, check constraints) are turned into plain messages instead of a generic 500. The caller still only sees a tidy message, never technical details.

### Screen rules

- Dates are shown as `dd-MMM-yy` (for example `24-Sep-26`). Date only values are read straight from the `YYYY-MM-DD` string, never through a `Date` object, so the day can not shift with the timezone. Timestamps are shown in UTC+3.
- No developer wording reaches the screen. A failure on the server side always shows "Something went wrong on our side. Please try again in a moment." and an unreachable API shows "We couldn't reach the server."

---

## Project Files

### Documentation

- `docs/er-diagram.png` — ER diagram
- `docs/er-diagram.dot` — Graphviz source

### Database

- `db/schema.sql` — table definitions, constraints, and database trigger
- `db/seed.sql` — sample employees and leave requests
- `docker-compose.yml` — PostgreSQL 16 setup

### API

- `leave-api/src/` — NestJS application source code
- `leave-api/.env.example` — example environment configuration
- `leave-api/package.json` — dependencies and available scripts

### Frontend

- `leave-frontend/app/` — pages (`page.tsx` is My requests, `new-request/`, `approvals/`), shared layout and components
- `leave-frontend/lib/api.ts` — the only place that talks to the API
- `leave-frontend/lib/format.ts` — date formatting
- `leave-frontend/.env.example` — example frontend configuration

### Request collection

- `postman/collections/leave-management-api/` — full request collection (kept locally via Postman's "Work locally with Git"), covering all 8 endpoints plus one failing example per validation rule

---

## Architecture

```text
Controller
    ↓
Service
    ↓
Repository (TypeORM) / Database
```

Controllers handle HTTP requests and responses only. Business rules and validation live in the service layer. Database access goes through TypeORM's `Repository<T>`, using parameterized queries rather than raw SQL string-building.

The frontend talks to the API only through `leave-frontend/lib/api.ts`.

## Known gaps

- No dedicated Repository class — services inject TypeORM's `Repository<T>` directly rather than going through a repository layer that's the only place allowed to build queries.
- No authentication yet (week 5) — `reviewerId`/`requesterId` are passed in the request body as a stopgap.
- The reviewer is checked to be a real employee, but not to be the manager of the person who asked. Real checks come with authentication.
- Employees who are no longer active still appear in the person menu.