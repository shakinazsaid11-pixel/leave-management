import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeaveRequest } from './entities/leave-request.entity';
import { LeaveBalance } from '../employees/entities/leave-balance.entity';
import { Employee } from '../employees/entities/employee.entity';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';

@Injectable()
export class LeaveRequestsService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepo: Repository<LeaveRequest>,
    @InjectRepository(LeaveBalance)
    private readonly leaveBalanceRepo: Repository<LeaveBalance>,
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
  ) {}

  async create(dto: CreateLeaveRequestDto): Promise<LeaveRequest> {
    // Rule 5: the employee must actually exist.
    const employee = await this.employeeRepo.findOne({
      where: { employeeId: dto.employeeId },
    });
    if (!employee) {
      throw new BadRequestException(
        `Employee ${dto.employeeId} does not exist`,
      );
    }

    if (new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date cannot be before start date');
    }

    // Compare against the start of today, not the current moment — a
    // request starting today should be allowed, not refused just because
    // midnight UTC today is "earlier" than right now.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (new Date(dto.startDate) < today) {
      throw new BadRequestException('Start date cannot be in the past');
    }

    const businessDays = this.countBusinessDays(
      new Date(dto.startDate),
      new Date(dto.endDate),
    );

    const leaveRequest = this.leaveRequestRepo.create({
      employeeId: dto.employeeId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      businessDays,
      status: 'PENDING',
    });
    return this.leaveRequestRepo.save(leaveRequest);
  }

  async findAll(filters: {
    employeeId?: number;
    status?: string;
    from?: string;
    to?: string;
  }): Promise<LeaveRequest[]> {
    const query = this.leaveRequestRepo.createQueryBuilder('lr');

    if (filters.employeeId) {
      query.andWhere('lr.employeeId = :employeeId', {
        employeeId: filters.employeeId,
      });
    }

    if (filters.status) {
      query.andWhere('lr.status = :status', { status: filters.status });
    }

    if (filters.from) {
      query.andWhere('lr.startDate >= :from', { from: filters.from });
    }

    if (filters.to) {
      query.andWhere('lr.endDate <= :to', { to: filters.to });
    }

    return query.getMany();
  }

  async findOne(id: number): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepo.findOne({
      where: { requestId: id },
    });
    if (!leaveRequest) {
      throw new NotFoundException(`Leave request ${id} was not found`);
    }
    return leaveRequest;
  }

  async approve(id: number, reviewerId: number): Promise<LeaveRequest> {
    const leaveRequest = await this.findOne(id);

    if (leaveRequest.status !== 'PENDING') {
      throw new BadRequestException(
        `Leave request ${id} is ${leaveRequest.status}, cannot approve`,
      );
    }

    // Rule 4: this request's dates must not overlap any other APPROVED
    // request for the same employee. "Overlap" here covers every case
    // where the two ranges share at least one day — see LOG.md for the
    // full breakdown of cases this single condition covers.
    const overlapping = await this.leaveRequestRepo
      .createQueryBuilder('lr')
      .where('lr.employeeId = :employeeId', {
        employeeId: leaveRequest.employeeId,
      })
      .andWhere('lr.status = :status', { status: 'APPROVED' })
      .andWhere('lr.requestId <> :id', { id: leaveRequest.requestId })
      .andWhere('lr.endDate >= :startDate', {
        startDate: leaveRequest.startDate,
      })
      .andWhere('lr.startDate <= :endDate', {
        endDate: leaveRequest.endDate,
      })
      .getOne();

    if (overlapping) {
      throw new ConflictException(
        `This request overlaps an existing approved request (${overlapping.startDate} to ${overlapping.endDate})`,
      );
    }

    // Rule 3: the balance is only checked at approval time, per the brief
    // ("only reduced when a request is approved, not when submitted").
    const year = new Date(leaveRequest.startDate).getUTCFullYear();

    const balance = await this.leaveBalanceRepo.findOne({
      where: { employeeId: leaveRequest.employeeId, year },
    });
    if (!balance) {
      throw new BadRequestException(
        `No leave balance on file for employee ${leaveRequest.employeeId} in ${year}`,
      );
    }

    const result = await this.leaveRequestRepo
      .createQueryBuilder('lr')
      .select('COALESCE(SUM(lr.businessDays), 0)', 'total')
      .where('lr.employeeId = :employeeId', {
        employeeId: leaveRequest.employeeId,
      })
      .andWhere('lr.status = :status', { status: 'APPROVED' })
      .andWhere('EXTRACT(YEAR FROM lr.startDate) = :year', { year })
      .getRawOne<{ total: string }>();

    const alreadyApproved = Number(result?.total ?? 0);
    const remaining = balance.totalDays - alreadyApproved;

    if (leaveRequest.businessDays > remaining) {
      throw new BadRequestException(
        `You have ${remaining} day(s) remaining and this request needs ${leaveRequest.businessDays} day(s)`,
      );
    }

    leaveRequest.status = 'APPROVED';
    leaveRequest.reviewerId = reviewerId;
    leaveRequest.reviewedAt = new Date();

    return this.leaveRequestRepo.save(leaveRequest);
  }

  async reject(
    id: number,
    reviewerId: number,
    reason: string,
  ): Promise<LeaveRequest> {
    const leaveRequest = await this.findOne(id);

    if (leaveRequest.status !== 'PENDING') {
      throw new BadRequestException(
        `Leave request ${id} is ${leaveRequest.status}, cannot reject`,
      );
    }

    if (!reason) {
      throw new BadRequestException('A rejection reason is required');
    }

    leaveRequest.status = 'REJECTED';
    leaveRequest.reviewerId = reviewerId;
    leaveRequest.reviewedAt = new Date();
    leaveRequest.rejectionReason = reason;

    return this.leaveRequestRepo.save(leaveRequest);
  }

  async cancel(id: number, requesterId: number): Promise<LeaveRequest> {
    const leaveRequest = await this.findOne(id);

    // Rule 7: an APPROVED request can only be cancelled by the employee's
    // manager, not by the employee themselves. A PENDING request can still
    // be cancelled by the employee — that part hasn't changed.
    if (leaveRequest.status === 'APPROVED') {
      const employee = await this.employeeRepo.findOne({
        where: { employeeId: leaveRequest.employeeId },
      });
      const isManager = !!employee && employee.managerId === requesterId;

      if (!isManager) {
        throw new ForbiddenException(
          "An approved request can only be cancelled by the employee's manager",
        );
      }
    } else if (leaveRequest.status !== 'PENDING') {
      throw new BadRequestException(
        `Leave request ${id} is ${leaveRequest.status}, cannot cancel`,
      );
    }

    // Cancelling keeps the review history — who approved it and when stays
    // on the record even after it's cancelled, per Tamer's review.
    leaveRequest.status = 'CANCELLED';

    return this.leaveRequestRepo.save(leaveRequest);
  }

  private countBusinessDays(start: Date, end: Date): number {
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const day = cursor.getUTCDay();
      if (day !== 5 && day !== 6) count++; // 5 = Friday, 6 = Saturday
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
  }
}