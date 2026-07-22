import { IsString, IsUrl, Length } from 'class-validator';

export class SetConnectionDto {
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'serverUrl must be a valid http(s) URL' },
  )
  serverUrl: string;

  @IsString()
  @Length(10, 512)
  apiKey: string;
}
