---Ext
----to prevent overlap----
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE employee (
    employee_id     SERIAL PRIMARY KEY,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    role            VARCHAR(20)  NOT NULL CHECK (role IN ('EMPLOYEE', 'MANAGER')),
    manager_id      INT REFERENCES employee(employee_id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (manager_id IS NULL OR manager_id <> employee_id)
);


CREATE TABLE leave_balance (
    employee_id     INT NOT NULL REFERENCES employee(employee_id),
    year            SMALLINT NOT NULL,
    total_days      SMALLINT NOT NULL DEFAULT 21 CHECK (total_days >= 0),
    PRIMARY KEY (employee_id, year)
);


CREATE TABLE leave_request (
    request_id        SERIAL PRIMARY KEY,
    employee_id        INT NOT NULL REFERENCES employee(employee_id),
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    business_days      SMALLINT NOT NULL CHECK (business_days > 0),
    status              VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    reviewer_id         INT REFERENCES employee(employee_id),
    reviewed_at         TIMESTAMPTZ,
    rejection_reason   VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
	-------CHECK (start_date >= CURRENT_DATE),
	CHECK (end_date >= start_date),
	CHECK (
    (status IN ('APPROVED', 'REJECTED') AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status = 'PENDING' AND reviewer_id IS NULL AND reviewed_at IS NULL)
    OR (status = 'CANCELLED')
),
 
    -- A rejection must always come with a reason; nothing else should have one.
    CHECK (
        (status = 'REJECTED' AND rejection_reason IS NOT NULL)
        OR (status <> 'REJECTED' AND rejection_reason IS NULL)
    )
);

-- No two APPROVED requests for the same employee may overlap in date range.
-- This is the DB-level guarantee behind "it must never let two approvals conflict" —
-- enforced by Postgres itself, not by application code.
ALTER TABLE leave_request
    ADD CONSTRAINT no_overlapping_approved_requests
    EXCLUDE USING gist (
        employee_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status = 'APPROVED');
 
CREATE INDEX idx_leave_request_employee ON leave_request(employee_id);
CREATE INDEX idx_leave_request_reviewer ON leave_request(reviewer_id);
CREATE INDEX idx_leave_request_status   ON leave_request(status);

-- Balance enforcement trigger

CREATE OR REPLACE FUNCTION enforce_leave_balance() RETURNS TRIGGER AS $$
DECLARE
    request_year SMALLINT;
    already_approved SMALLINT;
    entitlement SMALLINT;
BEGIN
    IF NEW.status <> 'APPROVED' THEN
        RETURN NEW;
    END IF;
 
    request_year := EXTRACT(YEAR FROM NEW.start_date);
 
    SELECT COALESCE(SUM(business_days), 0) INTO already_approved
    FROM leave_request
    WHERE employee_id = NEW.employee_id
      AND status = 'APPROVED'
      AND EXTRACT(YEAR FROM start_date) = request_year
      AND request_id <> COALESCE(NEW.request_id, -1);
 
    SELECT total_days INTO entitlement
    FROM leave_balance
    WHERE employee_id = NEW.employee_id AND year = request_year;
 
    IF entitlement IS NULL THEN
        RAISE EXCEPTION 'No leave_balance row for employee % in year %', NEW.employee_id, request_year;
    END IF;
 
    IF already_approved + NEW.business_days > entitlement THEN
        RAISE EXCEPTION 'Employee % has only % day(s) left in %, request needs %',
            NEW.employee_id, entitlement - already_approved, request_year, NEW.business_days;
    END IF;
 
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
 
CREATE TRIGGER trg_enforce_leave_balance
    BEFORE INSERT OR UPDATE ON leave_request
    FOR EACH ROW EXECUTE FUNCTION enforce_leave_balance();