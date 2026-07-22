import { IsOptional, IsString, IsUrl, Length } from 'class-validator';

export class SetConnectionDto {
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'serverUrl must be a valid http(s) URL' },
  )
  serverUrl: string;

  @IsString()
  @Length(10, 512)
  apiKey: string;

  /** Public URL for "open in Immich" links; optional. */
  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'publicUrl must be a valid http(s) URL' },
  )
  publicUrl?: string;
}
