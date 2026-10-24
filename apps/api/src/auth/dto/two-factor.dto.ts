import { IsString, MaxLength, MinLength } from 'class-validator';

export class TwoFactorPasswordDto {
  @IsString()
  @MaxLength(128)
  password: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code: string;
}

export class TwoFactorProofDto {
  @IsString()
  @MaxLength(128)
  password: string;

  /** A current code from the app, or a recovery code. */
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code: string;
}
