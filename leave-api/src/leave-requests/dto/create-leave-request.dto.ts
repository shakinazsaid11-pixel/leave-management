import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateLeaveRequestDto {
  @IsInt({ message: 'Please choose an employee.' })
  employeeId: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please enter the start date as a valid date.',
  })
  @IsISO8601(
    { strict: true },
    { message: 'Please enter the start date as a valid date.' },
  )
  startDate: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please enter the end date as a valid date.',
  })
  @IsISO8601(
    { strict: true },
    { message: 'Please enter the end date as a valid date.' },
  )
  endDate: string;

  @IsOptional()
  @IsString({ message: 'The note must be text.' })
  @MaxLength(500, { message: 'The note can be at most 500 characters.' })
  note?: string;
}