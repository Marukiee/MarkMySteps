import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImportedTripSummary, PolarstepsImportService } from './polarsteps-import.service';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // GDPR exports can be sizeable

@Controller('import')
@UseGuards(JwtAuthGuard)
export class ImportController {
  constructor(private readonly polarsteps: PolarstepsImportService) {}

  /**
   * Upload a Polarsteps "Download my data" zip; every trip found in it is
   * created for the current user with its GPS track (source = IMPORTED).
   */
  @Post('polarsteps')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  importPolarsteps(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ImportedTripSummary[]> {
    if (!file) {
      throw new BadRequestException('Upload the export zip as multipart field "file"');
    }
    return this.polarsteps.importZip(user.sub, file.buffer);
  }
}
