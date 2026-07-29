import { IsDateString, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class CreateTripDto {
  /** Client-chosen id. Restoring a backup, or handing a device-only account to
   *  a server for the first time, has to keep the ids the data already uses —
   *  everything below a trip refers to it. */
  @IsOptional()
  @IsUUID()
  id?: string;

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
