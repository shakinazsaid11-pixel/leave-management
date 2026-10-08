import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('leave_request')
export class LeaveRequest {
  @PrimaryGeneratedColumn({ name: 'request_id' })
  requestId: number;

  @Column({ name: 'employee_id', type: 'int' })
  employeeId: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ name: 'business_days', type: 'smallint' })
  businessDays: number;

  @Column({ length: 10 })
  status: string;

  @Column({ name: 'reviewer_id', type: 'int', nullable: true })
  reviewerId: number | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 255, nullable: true })
 rejectionReason: string | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}