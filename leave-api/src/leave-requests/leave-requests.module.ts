import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeaveRequest } from './entities/leave-request.entity';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveRequestsController } from './leave-requests.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LeaveRequest])],
  providers: [LeaveRequestsService],
  controllers: [LeaveRequestsController],
})
export class LeaveRequestsModule {}