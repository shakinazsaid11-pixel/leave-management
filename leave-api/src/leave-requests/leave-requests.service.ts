import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LeaveRequest } from './entities/leave-request.entity';
import { LeaveBalance } from '../employees/entities/leave-balance.entity';
import { Employee } from '../employees/entities/employee.entity';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

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
    // Same checks and same counting as the preview, so the number the
    // person saw before submitting is the number that gets stored.
    const businessDays = this.validateRange(dto.startDate, dto.endDate);

    // Rule 5: the employee must actually exist.
    const employee = await this.employeeRepo.findOne({
      where: { employeeId: dto.employeeId },
    });
    if (!employee) {
      throw new BadRequestException('We could not find this employee.');
    }

    const leaveRequest = this.leaveRequestRepo.create({
      employeeId: dto.employeeId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      businessDays,
      // Trim the note; an empty or whitespace-only note is stored as null.
      note: dto.note?.trim() || null,
      status: 'PENDING',
    });
    return this.leaveRequestRepo.save(leaveRequest);
  }

  // Tells the form how many days a request would deduct, before it is
  // submitted. It uses the exact same rules as create.
  preview(startDate: string, endDate: string): { businessDays: number } {
    return { businessDays: this.validateRange(startDate, endDate) };
  }

  // Checks that need no database access, and the business day count.
  // Shared by create and preview so they can never disagree.
  private validateRange(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end < start) {
      throw new BadRequestException(
        'The end date cannot be before the start date.',
      );
    }

    // "Today" is the date in Egypt, not in UTC. Dates are YYYY-MM-DD
    // strings, so they compare correctly as plain strings.
    const todayInCairo = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
      }).format(new Date());
    if (startDate.slice(0, 10) < todayInCairo) {
    throw new BadRequestException('The start date cannot be in the past.');
    } 

    // A range that only covers weekend days has zero business days, and
    // the database would reject it with a generic error. Refuse it here
    // with a clear message instead.
    const businessDays = this.countBusinessDays(start, end);
    if (businessDays === 0) {
      throw new BadRequestException(
        'The dates you chose have no working days. Please choose at least one day from Sunday to Thursday.',
      );
    }

    return businessDays;
  }

  async findAll(filters: {
    employeeId?: number;
    managerId?: number;
    status?: string;
    from?: string;
    to?: string;
  }): Promise<(LeaveRequest & { employeeName: string })[]> {
    // The ids come from the query string, so make sure they are real numbers.
    if (
      (filters.employeeId !== undefined &&
        !Number.isInteger(filters.employeeId)) ||
      (filters.managerId !== undefined && !Number.isInteger(filters.managerId))
    ) {
      throw new BadRequestException(
        'The employee and manager filters must be numbers.',
      );
    }

    const query = this.leaveRequestRepo.createQueryBuilder('lr');

    if (filters.employeeId) {
      query.andWhere('lr.employeeId = :employeeId', {
        employeeId: filters.employeeId,
      });
    }

    if (filters.managerId) {
      // Only requests from people who report to this manager.
      query
        .innerJoin(Employee, 'emp', 'emp.employeeId = lr.employeeId')
        .andWhere('emp.managerId = :managerId', {
          managerId: filters.managerId,
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

    // Newest first, so the list order is the same every time.
    const requests = await query
      .orderBy('lr.createdAt', 'DESC')
      .addOrderBy('lr.requestId', 'DESC')
      .getMany();

    // Attach each person's name so the screens never have to guess it.
    const employeeIds = [...new Set(requests.map((r) => r.employeeId))];
    const employees = employeeIds.length
      ? await this.employeeRepo.find({
          where: { employeeId: In(employeeIds) },
        })
      : [];
    const names = new Map(
      employees.map((e) => [e.employeeId, `${e.firstName} ${e.lastName}`]),
    );

    return requests.map((r) => ({
      ...r,
      employeeName: names.get(r.employeeId) ?? '',
    }));
  }

  async findOne(id: number): Promise<LeaveRequest> {
    const leaveRequest = await this.leaveRequestRepo.findOne({
      where: { requestId: id },
    });
    if (!leaveRequest) {
      throw new NotFoundException('We could not find this leave request.');
    }
    return leaveRequest;
  }

  async approve(id: number, reviewerId: number): Promise<LeaveRequest> {
    await this.assertReviewer(reviewerId);

    const leaveRequest = await this.findOne(id);

    if (leaveRequest.status !== 'PENDING') {
      throw new BadRequestException(
        'This request is no longer waiting for review, so it cannot be approved.',
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
        `This request overlaps approved leave from ${this.formatDate(overlapping.startDate)} to ${this.formatDate(overlapping.endDate)}.`,
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
        `No leave balance has been set up for this employee for ${year}.`,
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
        `This employee has ${remaining} day(s) left and this request needs ${leaveRequest.businessDays} day(s).`,
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
    await this.assertReviewer(reviewerId);

    // A rejection must always come with a reason. Whitespace only does not
    // count, and the database column holds at most 255 characters.
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason) {
      throw new BadRequestException(
        'Please give a reason for rejecting this request.',
      );
    }
    if (cleanReason.length > 255) {
      throw new BadRequestException(
        'The reason can be at most 255 characters.',
      );
    }

    const leaveRequest = await this.findOne(id);

    if (leaveRequest.status !== 'PENDING') {
      throw new BadRequestException(
        'This request is no longer waiting for review, so it cannot be rejected.',
      );
    }

    leaveRequest.status = 'REJECTED';
    leaveRequest.reviewerId = reviewerId;
    leaveRequest.reviewedAt = new Date();
    leaveRequest.rejectionReason = cleanReason;

    return this.leaveRequestRepo.save(leaveRequest);
  }

  async cancel(id: number, requesterId: number): Promise<LeaveRequest> {
    if (!Number.isInteger(requesterId)) {
      throw new BadRequestException(
        'Please choose who is cancelling this request.',
      );
    }

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
          "Only the employee's manager can cancel an approved request.",
        );
      }
    } else if (leaveRequest.status !== 'PENDING') {
      throw new BadRequestException('This request can no longer be cancelled.');
    }

    // Cancelling keeps the review history — who approved it and when stays
    // on the record even after it's cancelled, per Tamer's review.
    leaveRequest.status = 'CANCELLED';

    return this.leaveRequestRepo.save(leaveRequest);
  }

  // The reviewer must be given, and must be a real employee. Without this
  // check a missing or unknown id would reach the database and come back
  // as a generic server error.
  private async assertReviewer(reviewerId: number): Promise<void> {
    if (!Number.isInteger(reviewerId)) {
      throw new BadRequestException(
        'Please choose who is reviewing this request.',
      );
    }
    const reviewer = await this.employeeRepo.findOne({
      where: { employeeId: reviewerId },
    });
    if (!reviewer) {
      throw new BadRequestException('We could not find this reviewer.');
    }
  }

  // Turns "2026-08-30" into "30-Aug-26", reading the parts straight off the
  // string so the day can never shift with the server's timezone.
  private formatDate(dateString: string): string {
    const [year, month, day] = dateString.slice(0, 10).split('-').map(Number);
    return `${String(day).padStart(2, '0')}-${MONTHS[month - 1]}-${String(year).slice(-2)}`;
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