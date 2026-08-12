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
    const filePath = uploadedSave?.path ?? (body?.path ?? '').trim();

    if (!filePath) {
      throw new HttpException(
        'Upload a save file or provide a "path" field',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!fs.existsSync(filePath)) {
      throw new HttpException(
        `File not found: ${filePath}`,
        HttpStatus.NOT_FOUND,
      );
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
