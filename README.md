# Leave Management API

Backend API for the Leave Management System, built with NestJS, TypeORM, and PostgreSQL.

## Project Structure

```text
leave-management/
├── db/
├── docs/
├── leave-api/
└── docker-compose.yml
```

- `leave-api/` — NestJS backend API
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

---

## Available Scripts

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
| 1 | End date is before start date | 400 | `End date cannot be before start date` |
| 2 | Start date is in the past | 400 | `Start date cannot be in the past` |
| 3 | Requested days exceed remaining balance | 400 | `You have X day(s) remaining and this request needs Y day(s)` |
| 4 | Dates overlap an existing approved request | 409 | `This request overlaps an existing approved request (start to end)` |
| 5 | Employee does not exist | 400 | `Employee X does not exist` |
| 6 | Rejection submitted without a reason | 400 | `A rejection reason is required` |
| 7 | Approved request cancelled by the employee (not their manager) | 403 | `An approved request can only be cancelled by the employee's manager` |
| 8 | Request already approved/rejected/cancelled, approved again | 400 | `Leave request X is <status>, cannot approve` |

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

A leave request cannot be submitted for an employee who does not exist. Checked in `LeaveRequestsService.create`, before any date validation.

### 6. Rejection reason

Rejecting a leave request requires a rejection reason. Checked in `LeaveRequestsService.reject`.

### 7. Cancellation authorization

A `PENDING` request can be cancelled by the employee. An `APPROVED` request can only be cancelled by the employee's manager. There's no login yet, so the caller currently identifies themselves by passing `requesterId` in the body; the service checks that `requesterId` matches the employee's `managerId`. This is a placeholder until week 5 introduces real authentication.

### 8. Request status

A leave request that has already been approved, rejected, or cancelled cannot be approved (or rejected, or cancelled) again — only a `PENDING` request can change status. Checked at the top of `approve`, `reject`, and `cancel`.

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

## Known gaps

- No dedicated Repository class — services inject TypeORM's `Repository<T>` directly rather than going through a repository layer that's the only place allowed to build queries.
- No authentication yet (week 5) — `reviewerId`/`requesterId` are passed in the request body as a stopgap.