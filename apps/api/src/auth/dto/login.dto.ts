import { IsString, MaxLength } from 'class-validator';

export class LoginDto {
  /** E-mail address or username. */
  @IsString()
  @MaxLength(254)
  identifier: string;

  @IsString()
  @MaxLength(128)
  password: string;
}
