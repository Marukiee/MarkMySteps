import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export enum TravelModeDto {
  GROUND = 'GROUND',
  TRAIN = 'TRAIN',
  BUS = 'BUS',
  BOAT = 'BOAT',
  FLIGHT = 'FLIGHT',
}

export class CreateStopDto {
  /** Client-chosen id. Lets a stop created without a connection keep the same
   *  id once the queued request reaches the server, so the edits made after it
   *  (rename, reorder, a day trip hanging off it) still refer to the right row. */
  @IsOptional()
  @IsUUID()
  id?: string;

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

  @IsOptional()
  @IsEnum(TravelModeDto)
  travelMode?: TravelModeDto;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  flightNumber?: string;

  @IsOptional()
  @IsString()
  @Length(3, 4)
  fromAirport?: string;

  @IsOptional()
  @IsString()
  @Length(3, 4)
  toAirport?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Length(3, 4, { each: true })
  viaAirports?: string[];

  /** Insert after this stop; omitted = append at the end. */
  @IsOptional()
  @IsUUID()
  afterStopId?: string;

  /** Makes this a day trip FROM that stop instead of a leg of the route. */
  @IsOptional()
  @IsUUID()
  parentStopId?: string;

  /** The day the day trip took place (yyyy-mm-dd). */
  @IsOptional()
  @IsDateString()
  dayTripDate?: string;
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

  @IsOptional()
  @IsEnum(TravelModeDto)
  travelMode?: TravelModeDto;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  flightNumber?: string;

  @IsOptional()
  @IsString()
  @Length(3, 4)
  fromAirport?: string;

  @IsOptional()
  @IsString()
  @Length(3, 4)
  toAirport?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Length(3, 4, { each: true })
  viaAirports?: string[];

  /** Moves a day trip to another day (yyyy-mm-dd). */
  @IsOptional()
  @IsDateString()
  dayTripDate?: string;

  /** Draw no line from the previous stop to this one. */
  @IsOptional()
  @IsBoolean()
  hideLeg?: boolean;

  /**
   * The photo that fronts this stop's tile in the timeline rail. `null` puts
   * the automatic pick back. Owner-only, unlike the rest of this DTO.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  coverMediaId?: string | null;
}

export class ReorderStopsDto {
  /** Every stop id of the trip, in the new order. */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  stopIds: string[];
}
