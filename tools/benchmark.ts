import { readFile, writeFile, access } from 'node:fs/promises';
import {
  projectSchema,
  unitSchema,
  translateAndReview,
  validateProvider,
  estimateReservation,
  ProviderError,
  PIPELINE_REVISION,
  type ProviderConfig,
} from '../packages/core/dist/index.js';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: pnpm benchmark samples.json results.json');
let exists = false;
try {
  await access(output);
  exists = true;
} catch {}
if (exists)
  throw new Error('Choose a new output file to retain previous billing and quality evidence');
const samples = JSON.parse(await readFile(input, 'utf8')) as { project: unknown; units: unknown[] };
const project = projectSchema.parse(samples.project),
  units = samples.units.map((x) => unitSchema.parse(x));
function provider(prefix: string): ProviderConfig {
  const prices = [process.env[`${prefix}_INPUT_PRICE`], process.env[`${prefix}_OUTPUT_PRICE`]];
  if (prices.some((x) => x === undefined || x === ''))
    throw new Error('Explicit model prices are required');
  const config = {
    baseUrl: process.env[`${prefix}_URL`] ?? '',
    model: process.env[`${prefix}_MODEL`] ?? '',
    apiKey: process.env[`${prefix}_KEY`],
    inputPrice: Number(prices[0]),
    outputPrice: Number(prices[1]),
    maxOutputTokens: Number(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] ?? 4096),
    reasoningEffort: process.env[`${prefix}_REASONING_EFFORT`],
    onUsage: (result: import('../packages/core/dist/index.js').ModelResult) =>
      usage.push({ model: process.env[`${prefix}_MODEL`], ...result }),
  };
  validateProvider(config);
  return config;
}
let usage: unknown[] = [];
const generator = provider('EVERYLOCALE_GENERATOR'),
  reviewer = provider('EVERYLOCALE_REVIEWER');
const results = [];
let totalCost = 0;
let pendingReservation = 0;
const save = () =>
  writeFile(
    output,
    JSON.stringify(
      {
        pipelineRevision: PIPELINE_REVISION,
        generator: generator.model,
        reviewer: reviewer.model,
        totalCostUsd: totalCost,
        reservedUsd: pendingReservation,
        results,
      },
      null,
      2,
    ),
  );
for (const unit of units)
  for (const locale of project.targetLocales) {
    pendingReservation = estimateReservation(project, unit, locale, generator, reviewer);
    if (totalCost + pendingReservation > project.budgetUsd)
      throw new Error('Benchmark budget cannot cover the next generation and review');
    await save();
    const started = performance.now();
    usage = [];
    let costUsd = 0;
    let result;
    try {
      result = await translateAndReview(project, unit, locale, generator, reviewer, (cost) => {
        const exceeds = cost > pendingReservation + 1e-9;
        costUsd += cost;
        totalCost += cost;
        pendingReservation = Math.max(0, pendingReservation - cost);
        if (exceeds || totalCost > project.budgetUsd + 1e-9)
          throw new Error(
            'Provider usage exceeded the benchmark reservation; stopping further calls',
          );
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.costUsd !== undefined) {
          totalCost += error.costUsd;
          costUsd += error.costUsd;
          pendingReservation = Math.max(0, pendingReservation - error.costUsd);
        }
        if (error.uncertainCost) {
          totalCost += pendingReservation;
          costUsd += pendingReservation;
        }
      }
      pendingReservation = 0;
      results.push({
        unitId: unit.id,
        locale,
        source: unit.source,
        error: error instanceof Error ? error.message : 'Benchmark failed',
        costUsd,
        latencyMs: performance.now() - started,
        calls: usage,
      });
      await save();
      // Unmetered comparisons retain every failure rather than hiding difficult cases.
      if (
        process.env.EVERYLOCALE_BENCHMARK_CONTINUE === 'true' &&
        generator.inputPrice === 0 &&
        generator.outputPrice === 0 &&
        reviewer.inputPrice === 0 &&
        reviewer.outputPrice === 0
      )
        continue;
      throw error;
    }
    pendingReservation = 0;
    results.push({
      unitId: unit.id,
      locale,
      source: unit.source,
      ...result,
      costUsd,
      latencyMs: performance.now() - started,
      ownerCorrections: null,
      calls: usage,
    });
    await save();
  }
console.log(
  `Recorded ${results.length} benchmark cases. Results require owner review; these are not native-language certifications.`,
);
