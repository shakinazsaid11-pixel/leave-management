import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('employee')
export class Employee {
  @PrimaryGeneratedColumn({ name: 'employee_id' })
  employeeId: number;

  @Column({ name: 'first_name', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', length: 100 })
  lastName: string;

  @Column({ length: 150, unique: true })
  email: string;

  @Column({ length: 20 })
  role: string;

  @Column({ name: 'manager_id', type: 'int', nullable: true })
  managerId: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}