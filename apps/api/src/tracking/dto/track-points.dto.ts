import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class TrackPointDto {
  /** Client-generated UUID; makes offline batch uploads idempotent. */
  @IsUUID()
  clientId: string;

  @IsDateString()
  recordedAt: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  altitude?: number;
}

export class TrackBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => TrackPointDto)
  points: TrackPointDto[];
}

export class ManualPointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  /** Where on the timeline the point belongs; defaults to now. */
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}

/** Dragging a stored fix to where you actually were. */
export class MovePointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}

export class RouteFillDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

/** One end of a train ride: the station itself, as picked from the search. */
export class StationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

/** Drawing a train ride: the gap that was pressed, and the two stations. */
export class TrainFillDto extends RouteFillDto {
  @ValidateNested()
  @Type(() => StationDto)
  from: StationDto;

  @ValidateNested()
  @Type(() => StationDto)
  to: StationDto;
}
