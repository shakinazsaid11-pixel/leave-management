import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeaveRequest } from './entities/leave-request.entity';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';

@Injectable()
export class LeaveRequestsService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly leaveRequestRepo: Repository<LeaveRequest>,
  ) {}

  async create(dto: CreateLeaveRequestDto): Promise<LeaveRequest> {
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

  async cancel(id: number): Promise<LeaveRequest> {
    const leaveRequest = await this.findOne(id);

    if (leaveRequest.status !== 'PENDING') {
      throw new BadRequestException(
        `Leave request ${id} is ${leaveRequest.status}, cannot cancel`,
      );
    }

    leaveRequest.status = 'CANCELLED';

    return this.leaveRequestRepo.save(leaveRequest);
  }

  // الحساب ده منطق شغل (business logic)، عشان كده مكانه هنا في الـ service
  // مش حاجة الـ client يبعتها في الـ body.
  private countBusinessDays(start: Date, end: Date): number {
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) count++; 
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }
}