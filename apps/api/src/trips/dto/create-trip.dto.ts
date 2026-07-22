import { IsDateString, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateTripDto {
  @IsString()
  @Length(1, 120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
