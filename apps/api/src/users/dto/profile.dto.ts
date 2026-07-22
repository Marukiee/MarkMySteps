import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @Length(1, 80)
  displayName: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{3,30}$/, {
    message: 'username: 3-30 tekens, alleen letters, cijfers, punt, streepje of underscore',
  })
  username?: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, 128)
  currentPassword: string;

  @IsString()
  @Length(10, 128)
  newPassword: string;
}
