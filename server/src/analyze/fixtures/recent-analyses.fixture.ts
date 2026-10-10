import { PersistedAnalysisResultService } from '../persisted-analysis-result.service';
import { RecentAnalysesService } from '../recent-analyses.service';
import { SharedAnalysesService } from '../shared-analyses.service';

/** Direct test consumers must run the lifecycle hook normally awaited by Nest. */
export async function createRecentAnalyses(
  results: PersistedAnalysisResultService,
  shares?: SharedAnalysesService,
): Promise<RecentAnalysesService> {
  const recent = new RecentAnalysesService(results, shares);
  await recent.onApplicationBootstrap();
  return recent;
}
