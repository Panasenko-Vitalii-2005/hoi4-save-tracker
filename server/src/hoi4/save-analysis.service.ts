import { Injectable } from '@nestjs/common';
import { CountryResolver } from './country-resolver';
import { getGameMetadata } from './getGameMetadata';
import { resolve } from 'path';

export interface SaveReport {
  sessionId: string;
  saves: { path: string; countryNames: string[] }[];
}

@Injectable()
export class SaveAnalysisService {
  private countryResolver: CountryResolver | null = null;

  private async getResolver(): Promise<CountryResolver> {
    if (!this.countryResolver) {
      try {
        const jsonPath = resolve(__dirname, 'countries.json');
        this.countryResolver = await CountryResolver.fromJsonFile(jsonPath);
      } catch {
        this.countryResolver = CountryResolver.empty();
      }
    }
    return this.countryResolver;
  }

  async analyzeSaves(filePaths: string[]): Promise<SaveReport[]> {
    const resolver = await this.getResolver();
    const sessionMap = new Map<
      string,
      Array<{ path: string; countryNames: string[] }>
    >();

    const results = await Promise.all(
      filePaths.map(async (path) => {
        const metadata = await getGameMetadata(path);
        let countryNames: string[] = [];
        if (metadata.playerTag) {
          const resolvedName = resolver.getName(metadata.playerTag);
          countryNames = [resolvedName];
        }

        return { campaignId: metadata.campaignId, path, countryNames };
      }),
    );

    for (const item of results) {
      const group = sessionMap.get(item.campaignId) || [];
      group.push({ path: item.path, countryNames: item.countryNames });
      sessionMap.set(item.campaignId, group);
    }

    return Array.from(sessionMap.entries()).map(([sessionId, saves]) => ({
      sessionId,
      saves,
    }));
  }
}
