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

Copy `.env.example` to `.env` and set the required values:

```text
DB_PASSWORD=
DB_DATABASE=
PORT=
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

The API runs on the port configured in `.env`.

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

The project uses PostgreSQL.

The database is started using Docker Compose:

```bash
docker compose up -d
```

The database schema and seed data are loaded when the database is initialized.

To connect to PostgreSQL:

```bash
docker exec -it leave_management_db psql -U leave_admin -d leave_management
```

To completely reset the database:

```bash
docker compose down -v
docker compose up -d
```

---

## Week 1 Database Design

The database contains:

- Employees and managers
- Leave requests
- Leave balances
- Review information
- Soft deletion using `is_active`

Important database design decisions:

- Remaining leave balance is calculated from the source data.
- Friday and Saturday are excluded when calculating business days.
- `start_date` and `end_date` use `DATE`.
- Timestamp columns use `TIMESTAMPTZ`.
- The rule that a leave request cannot start in the past is handled by the application layer rather than a database constraint.
- Approved leave overlap is prevented at the database level.
- Balance enforcement is handled by a database trigger.
- Cancelling an approved request keeps its review history.
- Weekend-only leave requests should be rejected by the application layer.

---

## Week 3 Validation

Business validation is handled in the API service layer before database operations where possible.

The API validates the following rules:

| Rule | Status | Message |
|---|---:|---|
| End date is before start date | 400 | End date must be on or after start date. |
| Start date is in the past | 400 | Start date cannot be in the past. |
| Requested days exceed remaining balance | 400 | Requested leave days exceed the employee's remaining balance. |
| Dates overlap an existing approved request | 400 | Leave dates overlap an existing approved leave request. |
| Employee does not exist | 404 | Employee not found. |
| Rejection submitted without a reason | 400 | Rejection reason is required. |
| Approved request cancelled by employee | 403 | Only the manager can cancel an approved request. |
| Already approved/rejected/cancelled request approved again | 400 | This leave request has already been decided. |

All validation rules are enforced on the backend and return clear, human-readable error messages.

---

## Week 3 Validation Rules

### 1. Invalid Date Range

The end date cannot be before the start date.

### 2. Past Start Date

A new leave request cannot start in the past.

### 3. Remaining Balance

The requested business days cannot exceed the employee's remaining leave balance.

Friday and Saturday are excluded when calculating business days.

For example:

```text
Thursday → Friday → Saturday → Sunday
   1          -        -          1

Total = 2 business days
```

### 4. Overlapping Approved Leave

A new leave request cannot overlap an existing approved leave request for the same employee.

### 5. Employee Existence

A leave request cannot be submitted for an employee who does not exist.

### 6. Rejection Reason

Rejecting a leave request requires a rejection reason.

### 7. Cancellation Authorization

An approved leave request cannot be cancelled by the employee. Cancellation must be performed by the manager.

### 8. Request Status

A leave request that has already been approved, rejected, or cancelled cannot be approved again.

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

---

## Notes

The API follows a layered architecture:

```text
Controller
    ↓
Service
    ↓
Repository / Database
```

Controllers are responsible for handling HTTP requests and responses, while business rules and validation are handled in the service layer.

Database operations use parameterized queries / ORM operations to avoid unsafe SQL construction.