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
- `docs/` — ER diagram, documentation and screenshots
- `docker-compose.yml` — PostgreSQL container setup

---

## Requirements

- Node.js
- npm
- Docker Desktop (it must be running before you start the database)
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
docker compose down
docker compose up -d
```

### 2. Configure environment variables

Go to the API directory:

```bash
cd leave-api
```

Copy `.env.example` to `.env`. The defaults already match `docker-compose.yml` (the database is on port 5433 of your machine):

```bash
cp .env.example .env
```

On Windows (PowerShell or CMD) use:

```powershell
copy .env.example .env
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

Copy `.env.example` to `.env.local`. It holds the address of the API:

```bash
cp .env.example .env.local
```

On Windows (PowerShell or CMD) use:

```powershell
copy .env.example .env.local
```

The default (`http://localhost:3000`) matches the API's default port. `.env.local` is local configuration and should not be committed.

Start it:

```bash
npm run dev -- -p 3001
```

Then open `http://localhost:3001`. There is no login yet, so the menu at the top right switches between people while testing.

More detail is in `leave-frontend/README.md`.

### Troubleshooting

- **"unable to get image" or "failed to connect to the docker API"**: Docker Desktop is not running. Start it, wait until it says the engine is running, and try again.
- **"The container name /leave-management-db is already in use"**: another copy of this project already created a container with that name on your machine. Stop and rename the old one (`docker rename leave-management-db <new name>`) or remove it if you do not need its data. Do not remove it if it holds data you want to keep.

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

The project uses PostgreSQL 18, run through `docker-compose.yml`.

```bash
docker compose up -d
```

The database is published on port 5433 of your machine (5432 inside the container), which is why `DB_PORT` in `leave-api/.env.example` is 5433.

The schema and seed data are loaded automatically whenever the database container is created (Postgres runs everything in `/docker-entrypoint-initdb.d/` when its data folder is empty). The compose file has no volume for the data itself, so removing the container (`docker compose down`) also removes the data, and the next `docker compose up -d` starts again from the seed. To keep a container and its data between sessions, stop and start it instead:

```bash
docker stop leave-management-db
docker start leave-management-db
```

To connect to PostgreSQL directly:

```bash
docker exec -it leave-management-db psql -U postgres -d postgres
```

The seed contains 10 employees (3 of them managers) and 50 leave requests.

To completely reset the database (re-run schema + seed):

```bash
docker compose down
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

## Week 2 — The API

The backend is a NestJS application built on top of the week 1 schema. This section describes the API as it was built in week 2. Later weeks changed some of it, and each change is noted below.

### Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/employees` | List employees |
| GET | `/employees/:id` | One employee, with the remaining balance for the year |
| POST | `/leave-requests` | Submit a new request |
| GET | `/leave-requests` | List requests, filterable by `employeeId`, `status`, `from`, `to` |
| GET | `/leave-requests/:id` | One request |
| PATCH | `/leave-requests/:id/approve` | Approve (body: `{ "reviewerId": number }`) |
| PATCH | `/leave-requests/:id/reject` | Reject, with a reason (body: `{ "reviewerId": number, "reason": string }`) |
| PATCH | `/leave-requests/:id/cancel` | Cancel |

There is no login yet, so `approve` and `reject` take `reviewerId` in the body instead of working it out. The schema requires a reviewer on any reviewed row.

The number of business days is always counted by the server from `startDate` and `endDate`, never taken from the client. A request is created as `PENDING`, and only `approve`, `reject` and `cancel` change its status.

### Layers

- **Controller** (`*.controller.ts`) receives the request, calls the service and returns the result. It holds no business rules.
- **Service** (`*.service.ts`) holds all the business logic: business day counting on create, the remaining balance calculation, and the status rules (only a `PENDING` request can move to another status).
- **Repository** is currently TypeORM's own `Repository<T>`, injected straight into each service with `@InjectRepository`. It is not a separate class, which is the first of the known gaps below.

### What changed after week 2

- **Response shape.** In week 2 successes came back as `{ "success": true, "data": ... }` (through a global interceptor) but errors still used NestJS's default shape. Week 3 made every error come back as `{ "success": false, "error": { "statusCode", "message" } }`.
- **Past start dates.** In week 2 a past dated request reached the database and failed as a raw Postgres error. The database check was removed in the week 1 follow-up, and the rule now lives in `LeaveRequestsService` and returns a clear 400 (see Week 3).
- **Cancelling** now takes `requesterId` in the body and checks who is cancelling (Week 3, rule 7).
- **Added in week 4:** `GET /leave-requests/preview`, the `managerId` filter and `employeeName` on the list, and the balance fields on `GET /employees/:id`.

### Known gaps from week 2 that are still open

- **No separate Repository class.** Services inject `Repository<T>` directly instead of going through a dedicated layer that is the only code allowed to build queries. `LeaveRequestsService` builds its own queries (the filters in `findAll`, and the overlap and balance checks), which is query building that arguably belongs one layer down.

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
| 9 | Approve or reject by someone who is not the employee's manager (including the employee) | 403 | `Only the employee's manager can approve or reject this request.` |
| 10 | Approve or reject a request of an employee who has no manager | 403 | `This employee has no manager, so nobody can review this request yet.` |

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

### 9 and 10. Who may approve or reject

Only the manager of the employee who made the request can approve or reject it, so nobody can review their own request. The screen only shows the buttons to managers, but the rule is enforced on the server in `LeaveRequestsService.assertReviewerManagesEmployee`, because the API can be called without the screen. It is checked before the status and the reason, so someone who is not allowed to decide learns nothing about the request.

An employee with no manager (Nourhan in the seed data) has nobody who can review the request, and the API says so instead of letting anyone through. This needs a decision from the client (see `LOG.md`).

---

## Week 4 — User interface and input checks

### Screens

- **My requests** — remaining balance for the year and a table of the person's own requests (dates, days, status, rejection reason).
- **New request** — start date, end date and an optional note. The number of days that will be deducted comes from the API before submitting, and a refusal from the API is shown next to the form.
- **Approvals** — for managers: the requests waiting on their team, each with an approve and a reject button. Rejecting asks for a reason and cannot go ahead without one. A refusal from the API is shown on the request it belongs to.

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

- Dates are shown as `dd-MMM-yy` (for example `24-Sep-26`). Date only values are read straight from the `YYYY-MM-DD` string, never through a `Date` object, so the day can not shift with the timezone.
- No screen shows a time of day yet. The `formatDateTime` helper in `lib/format.ts` is ready for it and uses the `Africa/Cairo` timezone, which follows Egypt's clock changes, not a fixed number of hours.
- No developer wording reaches the screen. A failure on the server side always shows "Something went wrong on our side. Please try again in a moment." and an unreachable API shows "We couldn't reach the server."
- When the person is switched while an answer is still on its way, the old answer is ignored, so the screen never shows one person's data under another person's name.

---

## Project Files

### Documentation

- `docs/er-diagram.png` — ER diagram
- `docs/er-diagram.dot` — Graphviz source
- `docs/screenshots/` — screenshots of each screen state

### Database

- `db/schema.sql` — table definitions, constraints, and database trigger
- `db/seed.sql` — sample employees and leave requests
- `docker-compose.yml` — PostgreSQL 18 setup

### API

- `leave-api/src/` — NestJS application source code
- `leave-api/.env.example` — example environment configuration
- `leave-api/package.json` — dependencies and available scripts

### Frontend

- `leave-frontend/README.md` — how to run the frontend
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
- Nourhan has no manager, so her requests can not be approved or rejected by anyone yet. This needs a decision from the client (see `LOG.md`).
- Who is calling is still sent in the request body (`reviewerId`, `requesterId`), so anyone who calls the API directly can claim to be a manager. Real authentication in week 5 replaces this.
- Employees who are no longer active still appear in the person menu.
- The database container has no volume for its data, so `docker compose down` removes the data too and the next start re-runs the seed.