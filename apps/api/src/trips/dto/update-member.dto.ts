import { TripRole } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional, Matches } from 'class-validator';

export class UpdateMemberDto {
  /** Only MEMBER (reisgenoot) or GUEST — the owner role can't be assigned here. */
  @IsOptional()
  @IsIn([TripRole.MEMBER, TripRole.GUEST])
  role?: TripRole;

  @IsOptional()
  @IsBoolean()
  canTrack?: boolean;

  /** The first day they were there, 'YYYY-MM-DD'; null for the trip's first day. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate?: string | null;

  /** The last day they were there, 'YYYY-MM-DD'; null for the trip's last day. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate?: string | null;
}
