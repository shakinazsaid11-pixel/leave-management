import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('leave_balance')
export class LeaveBalance {
  @PrimaryColumn({ name: 'employee_id', type: 'int' })
  employeeId: number;

  @PrimaryColumn({ type: 'smallint' })
  year: number;

  @Column({ name: 'total_days', type: 'smallint' })
  totalDays: number;
}