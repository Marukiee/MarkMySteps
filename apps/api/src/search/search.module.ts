import { Module } from '@nestjs/common';
import { ImmichModule } from '../immich/immich.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [ImmichModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
