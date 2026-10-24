import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginMfaDto {
  /** The short-lived token that /auth/login handed out after the password. */
  @IsString()
  @MaxLength(1024)
  mfaToken: string;

  /** Six digits from the app, or one recovery code. */
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code: string;
}
