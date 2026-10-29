import { Module } from '@nestjs/common';
import { ImmichModule } from '../immich/immich.module';
import { SearchController } from './search.controller';
import { PlaceLookupService } from './place-lookup.service';
import { SearchService } from './search.service';

@Module({
  imports: [ImmichModule],
  controllers: [SearchController],
  providers: [SearchService, PlaceLookupService],
})
export class SearchModule {}
