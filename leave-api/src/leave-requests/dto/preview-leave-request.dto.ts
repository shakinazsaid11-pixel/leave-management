import { IsISO8601, Matches } from 'class-validator';

export class PreviewLeaveRequestDto {
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
}