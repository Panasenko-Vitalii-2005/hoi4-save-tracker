import { readFile, readdir, writeFile } from 'fs/promises';
import { join, resolve, extname } from 'path';
import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';

const COUNTRY_LINE_RE =
  /^\s*([A-Z][A-Z0-9]{2})\s*:\s*\d+\s*"((?:\\.|[^"\\])*)"/;
const BOM = '\uFEFF';

function stripBom(value: string): string {
  return value.startsWith(BOM) ? value.slice(1) : value;
}

function unescapeParadoxString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Read all `.yml` / `.yaml` files under a localisation directory and extract country names.
 * Only exact 3-character tags are accepted, so TAG_ADJ / TAG_DEF are ignored.
 */
export async function buildCountryNameMap(
  sourceDir: string,
): Promise<Record<string, string>> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const map: Record<string, string> = {};

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (extension !== '.yml' && extension !== '.yaml') continue;

    const filePath = join(sourceDir, entry.name);
    const contents = stripBom(await readFile(filePath, 'utf8'));
    const lines = contents.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = COUNTRY_LINE_RE.exec(line);
      if (!match) continue;

      const tag = match[1].toUpperCase();
      const name = unescapeParadoxString(match[2]);
      if (!(tag in map)) {
        map[tag] = name;
      }
    }
  }

  return map;
}

/**
 * Generate a JSON file containing a simple { TAG: Name } mapping.
 */
export async function generateCountriesJson(
  sourceDir: string,
  outputPath: string,
): Promise<void> {
  const map = await buildCountryNameMap(sourceDir);
  const json = JSON.stringify(map, null, 2) + '\n';
  await writeFile(outputPath, json, 'utf8');
}

/**
 * Lightweight country name resolver that loads the mapping once from disk.
 */
export class CountryResolver {
  private static cache = new Map<string, CountryResolver>();
  private constructor(private readonly names: Record<string, string>) {}

  /**
   * Load or reuse a resolver instance from the provided JSON file.
   */
  public static async fromJsonFile(jsonPath: string): Promise<CountryResolver> {
    const resolvedPath = resolve(jsonPath);
    const cached = CountryResolver.cache.get(resolvedPath);
    if (cached) return cached;

    const raw = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(stripBom(raw)) as Record<string, string>;
    const resolver = new CountryResolver(parsed);
    CountryResolver.cache.set(resolvedPath, resolver);
    return resolver;
  }

  /**
   * Return the full country name for a tag, or the tag itself when unknown.
   */

  public getName(tag: string): string {
    const key = tag.trim().toUpperCase();
    return this.names[key] ?? tag;
  }

  public static empty(): CountryResolver {
    return new CountryResolver({});
  }
}

/**
 * Optional CLI entrypoint for quick JSON generation.
 * Example: npx ts-node src/hoi4/country-resolver.ts ./localisation ./src/hoi4/countries.json
 */
if (process.argv[1]?.endsWith('country-resolver.ts')) {
  const [, , sourceDir, outputFile] = process.argv;
  if (!sourceDir || !outputFile) {
    console.error(
      'Usage: ts-node src/hoi4/country-resolver.ts <source-dir> <output-json>',
    );
    process.exitCode = 1;
  } else {
    generateCountriesJson(sourceDir, outputFile).catch((error) => {
      console.error('Failed to generate countries JSON:', error);
      process.exitCode = 1;
    });
  }
}
