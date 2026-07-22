import { IsString, Matches } from 'class-validator';

export class AddMemberDto {
  @IsString()
  @Matches(/^@?[a-zA-Z0-9._-]{3,30}$/, { message: 'Invalid username' })
  username: string;
}
