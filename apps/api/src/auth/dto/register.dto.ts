import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{3,30}$/, {
    message: 'username: 3-30 tekens, alleen letters, cijfers, punt, streepje of underscore',
  })
  username: string;

  @IsString()
  @Length(1, 80)
  displayName: string;

  @IsString()
  @Length(10, 128)
  password: string;
}
