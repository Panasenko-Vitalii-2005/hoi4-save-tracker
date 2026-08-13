import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeSave } from '../hoi4/hoi4-parser';
import { LocalSavePathError, resolveLocalSavePath } from '../saves/local-saves';

interface AnalyzeRequest {
  path: string;
}

interface UploadedSave {
  path: string;
}

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const UPLOAD_DIRECTORY = path.join(os.tmpdir(), 'hoi4-save-tracker');

fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true });

@Controller('api/analyze')
export class AnalyzeController {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      dest: UPLOAD_DIRECTORY,
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  analyze(
    @Body() body: AnalyzeRequest,
    @UploadedFile() uploadedSave?: UploadedSave,
  ) {
    const requestedPath = (body?.path ?? '').trim();

    if (!uploadedSave && !requestedPath) {
      throw new HttpException(
        'Upload a save file or provide a "path" field',
        HttpStatus.BAD_REQUEST,
      );
    }

    let filePath = uploadedSave?.path;
    if (!filePath) {
      try {
        filePath = resolveLocalSavePath(requestedPath);
      } catch (error: unknown) {
        if (error instanceof LocalSavePathError) {
          const status =
            error.code === 'file_not_found' || error.code === 'root_unavailable'
              ? HttpStatus.NOT_FOUND
              : HttpStatus.BAD_REQUEST;
          throw new HttpException(error.message, status);
        }
        throw error;
      }
    }

    try {
      return analyzeSave(filePath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(
        `Parse error: ${msg}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      if (uploadedSave) {
        try {
          fs.unlinkSync(uploadedSave.path);
        } catch {
          // The analysis result is still valid if temporary-file cleanup fails.
        }
      }
    }
  }
}
