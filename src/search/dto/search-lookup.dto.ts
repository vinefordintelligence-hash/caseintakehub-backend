import { IsString, Matches, MaxLength } from 'class-validator';

export class SearchLookupDto {
  @IsString()
  @MaxLength(64)
  @Matches(
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|VF-[0-9]{4}-[0-9]+)$/i,
  )
  id!: string;
}
