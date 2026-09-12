import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './entities/employee.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { LeaveRequest } from '../leave-requests/entities/leave-request.entity';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Employee, LeaveBalance, LeaveRequest])],
  providers: [EmployeesService],
  controllers: [EmployeesController],
})
export class EmployeesModule {}