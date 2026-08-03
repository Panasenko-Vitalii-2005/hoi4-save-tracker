import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import * as fs from 'fs';
import { analyzeSave } from '../hoi4/hoi4-parser';

interface AnalyzeRequest {
  path: string;
}

@Controller('api/analyze')
export class AnalyzeController {
  @Post()
  analyze(@Body() body: AnalyzeRequest) {
    const filePath = (body?.path ?? '').trim();

    if (!filePath) {
      throw new HttpException('Missing "path" field', HttpStatus.BAD_REQUEST);
    }

    if (!fs.existsSync(filePath)) {
      throw new HttpException(`File not found: ${filePath}`, HttpStatus.NOT_FOUND);
    }

    try {
      return analyzeSave(filePath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(`Parse error: ${msg}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
