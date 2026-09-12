import AdmZip from 'adm-zip';

export const smallSave = (extra = '') =>
  `HOI4txt\ndate="1944.5.1.2"\ncountries={ GER={ units={} } }\n${extra}`;

export const binarySave = () =>
  Buffer.concat([
    Buffer.from('HOI4bin', 'ascii'),
    Buffer.from([0x35, 0x2a, 0x01, 0x00, 0x0f, 0x00, 0x03, 0x00]),
  ]);

export function zipSave(
  text: string | Buffer = smallSave(),
  name = 'gamestate',
): Buffer {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'));
  zip.getEntries()[0].entryName = name; // Preserve hostile names: addFile normally normalizes traversal.
  return zip.toBuffer();
}

export function zipOffsets(bytes: Buffer) {
  const end = bytes.length - 22;
  const central = bytes.readUInt32LE(end + 16);
  const data = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
  return { end, central, data };
}

export function forgedZipSize(size: number, text: string): Buffer {
  const bytes = zipSave(text);
  bytes.writeUInt32LE(size, zipOffsets(bytes).central + 24);
  bytes.writeUInt32LE(size, 22);
  return bytes;
}
