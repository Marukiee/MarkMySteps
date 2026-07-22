import { IsEmail, MaxLength } from 'class-validator';

export class AddMemberDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}
