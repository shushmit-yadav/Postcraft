import type { OutputFormat, Script, Tone } from '@app/shared';
import type { AnalysisData, ProductData } from '../../db/schema.js';

export interface AnalyzeInput {
  product: ProductData;
  /** Local paths to the saved product images, same order as product.imageAssetIds. */
  imagePaths: string[];
  signal: AbortSignal;
}

export interface ScriptInput {
  product: ProductData;
  analysis: AnalysisData;
  format: OutputFormat;
  tone: Tone;
  imageCount: number;
  /** Seconds available for the middle scenes (the renderer adds a fixed intro and outro). */
  sceneSeconds: number;
  signal: AbortSignal;
}

/**
 * Where marketing intelligence comes from. MockProvider is deterministic and
 * offline; ClaudeProvider uses vision + structured output. The pipeline does
 * not know which one it is talking to.
 */
export interface ContentProvider {
  readonly name: 'mock' | 'claude';
  analyze(input: AnalyzeInput): Promise<AnalysisData>;
  writeScript(input: ScriptInput): Promise<Script>;
}
