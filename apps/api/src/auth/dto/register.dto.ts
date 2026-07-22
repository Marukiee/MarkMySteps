import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(1, 80)
  displayName: string;

  @IsString()
  @Length(10, 128)
  password: string;
}
