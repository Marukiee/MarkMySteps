import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches } from 'class-validator';

const USERNAME = /^@?[a-zA-Z0-9._-]{3,30}$/;

export class AddMemberDto {
  /** One handle. Older app builds only ever send this. */
  @IsOptional()
  @IsString()
  @Matches(USERNAME, { message: 'Invalid username' })
  username?: string;

  /**
   * Several at once — the picker lets you tick a list, and adding four people
   * one at a time meant looking up four names you had already found.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Matches(USERNAME, { each: true, message: 'Invalid username' })
  usernames?: string[];
}
