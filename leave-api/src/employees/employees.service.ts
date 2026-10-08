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

  // Ordered so the employee selector always lists people in the same order.
  findAll(): Promise<Employee[]> {
    return this.employeeRepo.find({ order: { employeeId: 'ASC' } });
  }

  async findOne(id: number) {
    const employee = await this.employeeRepo.findOne({
      where: { employeeId: id },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${id} was not found`);
    }

    const year = new Date().getFullYear();
    const { totalDays, usedDays } = await this.getBalance(id, year);

    return {
      ...employee,
      balanceYear: year,
      totalDays,
      usedDays,
      remainingDays: totalDays - usedDays,
    };
  }

  // Total entitlement for the year, and how much of it APPROVED requests
  // have already used.
  private async getBalance(
    employeeId: number,
    year: number,
  ): Promise<{ totalDays: number; usedDays: number }> {
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, year },
    });
    const totalDays = balance?.totalDays ?? 0;

    const { sum } = await this.leaveRequestRepo
      .createQueryBuilder('lr')
      .select('COALESCE(SUM(lr.businessDays), 0)', 'sum')
      .where('lr.employeeId = :employeeId', { employeeId })
      .andWhere('lr.status = :status', { status: 'APPROVED' })
      .andWhere('EXTRACT(YEAR FROM lr.startDate) = :year', { year })
      .getRawOne();

    return { totalDays, usedDays: Number(sum) };
  }
}