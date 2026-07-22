import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateStopDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsInt()
  @Min(0)
  @Max(365)
  nights: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** ISO 3166-1 alpha-2 country code (e.g. "VN"). */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  /** Insert after this stop; omitted = append at the end. */
  @IsOptional()
  @IsUUID()
  afterStopId?: string;
}

export class UpdateStopDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  nights?: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;
}

export class ReorderStopsDto {
  /** Every stop id of the trip, in the new order. */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  stopIds: string[];
}
