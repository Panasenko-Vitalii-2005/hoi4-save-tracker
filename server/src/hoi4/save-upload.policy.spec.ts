import { sanitizeSaveFileName, saveUploadPolicy } from './save-upload.policy';

describe('Public save upload policy', () => {
  test('safe defaults comfortably accept the real control save', () => {
    const policy = saveUploadPolicy({});
    expect(policy).toEqual({
      maxUploadBytes: 268435456,
      maxUncompressedBytes: 536870912,
      analysisTimeoutMs: 60000,
      uploadTimeoutMs: 120000,
      maxConcurrentRequests: 2,
      maxWorkerHeapMb: 1024,
    });
    expect(104534765).toBeLessThan(policy.maxUploadBytes);
  });
  test('valid environment overrides remain bounded', () => {
    expect(
      saveUploadPolicy({
        HOI4_MAX_UPLOAD_BYTES: '536870912',
        HOI4_MAX_UNCOMPRESSED_BYTES: '1073741824',
        HOI4_ANALYSIS_TIMEOUT_MS: '90000',
        HOI4_UPLOAD_TIMEOUT_MS: '180000',
        HOI4_ANALYSIS_REQUESTS: '4',
        HOI4_ANALYSIS_HEAP_MB: '2048',
      }),
    ).toEqual({
      maxUploadBytes: 536870912,
      maxUncompressedBytes: 1073741824,
      analysisTimeoutMs: 90000,
      uploadTimeoutMs: 180000,
      maxConcurrentRequests: 4,
      maxWorkerHeapMb: 2048,
    });
  });
  test.each([
    '',
    '0',
    '-1',
    'abc',
    'Infinity',
    '1.5',
    '9007199254740992',
    '2147483648',
  ])('invalid config %j falls back instead of disabling limits', (value) => {
    expect(
      saveUploadPolicy({
        HOI4_MAX_UPLOAD_BYTES: value,
        HOI4_MAX_UNCOMPRESSED_BYTES: value,
        HOI4_ANALYSIS_TIMEOUT_MS: value,
        HOI4_UPLOAD_TIMEOUT_MS: value,
        HOI4_ANALYSIS_REQUESTS: value,
        HOI4_ANALYSIS_HEAP_MB: value,
      }),
    ).toEqual(saveUploadPolicy({}));
  });
  test.each([
    ['../../evil.hoi4', 'evil.hoi4'],
    ['..\\..\\evil.hoi4', 'evil.hoi4'],
    ['C:\\Users\\evil\\save.hoi4', 'save.hoi4'],
    ['save', 'save'],
    ['save.hoi4', 'save.hoi4'],
    [
      'weird Möwe Potosí 日本語 save.hoi4',
      'weird Möwe Potosí 日本語 save.hoi4',
    ],
    ['bad\u0000\n\t\u202ename.hoi4', 'badname.hoi4'],
  ])('sanitizes %j without destroying Unicode', (input, expected) => {
    expect(sanitizeSaveFileName(input)).toBe(expected);
  });
});
