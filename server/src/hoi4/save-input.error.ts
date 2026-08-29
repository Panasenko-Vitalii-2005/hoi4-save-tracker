export const SAVE_ERRORS = {
  FILE_TOO_LARGE: [413, 'This save is larger than the current upload limit.'],
  EMPTY_FILE: [400, 'The uploaded save is empty.'],
  UNSUPPORTED_FILE_TYPE: [415, 'Choose a Hearts of Iron IV .hoi4 save file.'],
  INVALID_SAVE: [
    400,
    'This save appears to be corrupted, incomplete, or not a Hearts of Iron IV save.',
  ],
  UNSUPPORTED_SAVE: [
    422,
    'This HoI4 save uses a structure or format that this analyzer does not support.',
  ],
  CORRUPT_ARCHIVE: [
    400,
    'This compressed save appears to be corrupted or incomplete.',
  ],
  DECOMPRESSED_SIZE_LIMIT: [
    413,
    'The uncompressed save exceeds the configured size limit.',
  ],
  UPLOAD_TIMEOUT: [408, 'The upload took too long and was stopped.'],
  ANALYSIS_TIMEOUT: [504, 'Analysis took too long and was stopped.'],
  ANALYZER_BUSY: [
    503,
    'The analyzer is busy. Please try again in a few seconds.',
  ],
  ANALYSIS_FAILED: [500, 'Could not analyze the save. Please try again.'],
} as const;

export type SaveErrorCode = keyof typeof SAVE_ERRORS;

/** Serializable across Worker boundaries; never carries user-controlled messages. */
export class SaveInputError extends Error {
  constructor(public readonly code: SaveErrorCode) {
    super(SAVE_ERRORS[code][1]);
    this.name = 'SaveInputError';
  }
}

export function isSaveErrorCode(value: unknown): value is SaveErrorCode {
  return typeof value === 'string' && Object.hasOwn(SAVE_ERRORS, value);
}
