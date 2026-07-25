import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsHexColor, IsNumber, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { CreateTripDto } from './create-trip.dto';

export class UpdateTripDto extends PartialType(CreateTripDto) {
  /** MediaRef id used as trip cover; null clears it (back to gradient). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  coverMediaId?: string | null;

  @IsOptional()
  @IsBoolean()
  autoTrack?: boolean;

  /** Custom trip colour (hex) for the globe/map; null resets to auto. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsHexColor()
  color?: string | null;

  /** Manual globe-marker position; both null resets to auto (route start/end). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  markerLng?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  markerLat?: number | null;
}
