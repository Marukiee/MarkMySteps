import { TripRole } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class UpdateMemberDto {
  /** Only MEMBER (reisgenoot) or GUEST — the owner role can't be assigned here. */
  @IsOptional()
  @IsIn([TripRole.MEMBER, TripRole.GUEST])
  role?: TripRole;

  @IsOptional()
  @IsBoolean()
  canTrack?: boolean;
}
