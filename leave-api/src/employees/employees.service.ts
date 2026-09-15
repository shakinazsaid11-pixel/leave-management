import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './entities/employee.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { LeaveRequest } from '../leave-requests/entities/leave-request.entity';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    @InjectRepository(LeaveBalance)
    private readonly balanceRepo: Repository<LeaveBalance>,
    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepo: Repository<LeaveRequest>,
  ) {}

  findAll(): Promise<Employee[]> {
    return this.employeeRepo.find();
  }

  async findOne(id: number) {
    const employee = await this.employeeRepo.findOne({ where: { employeeId: id } });
    if (!employee) {
      throw new NotFoundException(`Employee ${id} was not found`);
    }

    const year = new Date().getFullYear();
    const remainingDays = await this.getRemainingBalance(id, year);

    return { ...employee, remainingDays, balanceYear: year };
  }

  private async getRemainingBalance(employeeId: number, year: number): Promise<number> {
    const balance = await this.balanceRepo.findOne({ where: { employeeId, year } });
    const totalDays = balance?.totalDays ?? 0;

    const { sum } = await this.leaveRequestRepo
      .createQueryBuilder('lr')
      .select('COALESCE(SUM(lr.businessDays), 0)', 'sum')
      .where('lr.employeeId = :employeeId', { employeeId })
      .andWhere('lr.status = :status', { status: 'APPROVED' })
      .andWhere('EXTRACT(YEAR FROM lr.startDate) = :year', { year })
      .getRawOne();

    return totalDays - Number(sum);
  }
}