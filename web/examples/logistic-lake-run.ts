import { parseResult, type RunRequest, type RunResult } from '../packages/contracts/index.js';
import type { LakeDomain } from './logistic-grid.js';
import type { LakeExchange } from './logistic-lake-exchange.js';
import type { LakeMesh } from './logistic-lake.js';

type BatchTrace = {
  modelId: string;
  runId?: string;
  elapsedMs: number;
  cells: number;
  runCalls: number;
  points: number;
  resultBytes: number;
  errors?: NumericalErrors;
};

type NumericalErrors = { maxAbsoluteTonnes: number; maxRelative: number };
const emptyErrors = (): NumericalErrors => ({ maxAbsoluteTonnes: 0, maxRelative: 0 });

export type LakeRunTrace = {
  parameters: LakeDomain['parameters'];
  exchange?: LakeExchange;
  startedAt: string;
  elapsedMs: number;
  wetCells: number;
  plannedBatches: number;
  batches: BatchTrace[];
  points: number;
  resultBytes: number;
  localErrors?: NumericalErrors;
  aggregateErrors?: NumericalErrors;
  failure?: { modelId: string; elapsedMs: number; message: string; resultBytes?: number };
};

export type LakeReference = { local: number[][]; total: number[] };
export type LakePlan = { mesh: LakeMesh; domain: LakeDomain; reference: LakeReference };
export type LakeExchangePlan = { mesh: LakeMesh; domain: LakeDomain & { exchange: LakeExchange } };

export class LakeRunError extends Error {
  constructor(public trace: LakeRunTrace, cause: unknown) {
    super(`Lot ${trace.batches.length + 1}/${trace.plannedBatches} · ${trace.failure!.message}`, { cause });
  }
}

function recordError(errors: NumericalErrors, observed: number, expected: number) {
  const absolute = Math.abs(observed - expected);
  errors.maxAbsoluteTonnes = Math.max(errors.maxAbsoluteTonnes, absolute);
  errors.maxRelative = Math.max(errors.maxRelative, absolute / expected);
}

export async function runLakeBatches(domain: LakeDomain & { exchange?: LakeExchange }, reference: LakeReference | undefined,
  execute: (request: RunRequest) => Promise<unknown>, options: {
  signal?: AbortSignal;
  onProgress?: (completed: number) => void;
} = {}) {
  const { parameters, cells, batches } = domain;
  const { signal, onProgress } = options;
  const { start, end } = parameters.simulation;
  const ticks = Math.round((end - start) / parameters.samplingInterval) + 1;
  const totals = new Float64Array(ticks);
  const observations = new Map<string, RunResult['observations'][number]>();
  const cellIndices = new Map(cells.map((cell, index) => [cell.component, index]));
  const encoder = new TextEncoder();
  const started = performance.now();
  const trace: LakeRunTrace = {
    parameters, startedAt: new Date().toISOString(), elapsedMs: 0, wetCells: cells.length,
    plannedBatches: batches.length, batches: [], points: 0, resultBytes: 0,
    ...(domain.exchange && { exchange: domain.exchange }),
  };
  const localErrors = emptyErrors();

  for (const { request, cells: members } of batches) {
    signal?.throwIfAborted();
    const batchStarted = performance.now();
    let resultBytes: number | undefined;
    try {
      const raw = await execute(request);
      signal?.throwIfAborted();
      resultBytes = encoder.encode(JSON.stringify(raw)).byteLength;
      const result = parseResult(raw, request);
      const runId = (raw as { runId?: unknown }).runId;
      const errors = emptyErrors();
      for (const [index, observation] of result.observations.entries()) {
        const cell = members[index];
        const cellIndex = cellIndices.get(observation.component);
        if (!cell || observation.component !== cell.component || observations.has(cell.component) || cellIndex === undefined) {
          throw new Error(`Observation inattendue ou en double pour ${observation.component}.`);
        }
        const analytical = reference?.local[cellIndex];
        const { samples } = observation;
        if (samples.length !== ticks) throw new Error(`Série incomplète pour ${observation.component} (${samples.length}/${ticks} points).`);
        if (Math.abs(samples[0]!.value - cell.initial) > 32 * Number.EPSILON * cell.initial) {
          throw new Error(`Biomasse initiale inattendue pour ${observation.component}.`);
        }
        for (const [tick, { time, value }] of samples.entries()) {
          const expectedTime = tick === ticks - 1 ? end : start + tick * parameters.samplingInterval;
          if (Math.abs(time - expectedTime) > 32 * Number.EPSILON * Math.max(1, Math.abs(expectedTime))) {
            throw new Error(`Date inattendue pour ${observation.component} à l’indice ${tick}.`);
          }
          if (value < 0) throw new Error(`Biomasse négative pour ${observation.component} à l’indice ${tick}.`);
          if (analytical) {
            recordError(errors, value, analytical[tick]!);
            totals[tick] = totals[tick]! + value;
          }
        }
      }
      const points = result.observations.length * ticks;
      trace.batches.push({ modelId: result.modelId, ...(typeof runId === 'string' ? { runId } : {}),
        elapsedMs: performance.now() - batchStarted, cells: members.length, runCalls: result.simulation.runCalls,
        points, resultBytes, ...(reference && { errors }) });
      trace.points += points;
      trace.resultBytes += resultBytes;
      if (reference) {
        localErrors.maxAbsoluteTonnes = Math.max(localErrors.maxAbsoluteTonnes, errors.maxAbsoluteTonnes);
        localErrors.maxRelative = Math.max(localErrors.maxRelative, errors.maxRelative);
        trace.localErrors = localErrors;
      }
      for (const observation of result.observations) observations.set(observation.component, observation);
    } catch (cause) {
      signal?.throwIfAborted();
      trace.elapsedMs = performance.now() - started;
      const detail = cause instanceof Error ? cause.message : String(cause);
      const message = cause instanceof Error && 'code' in cause ? `${String(cause.code)} · ${detail}` : detail;
      trace.failure = { modelId: request.model.id, elapsedMs: performance.now() - batchStarted, message,
        ...(resultBytes === undefined ? {} : { resultBytes }) };
      throw new LakeRunError(trace, cause);
    }
    onProgress?.(trace.batches.length);
  }

  if (observations.size !== cells.length) throw new Error('Les lots ne couvrent pas toutes les cellules humides.');
  if (reference) {
    const aggregateErrors = emptyErrors();
    totals.forEach((total, tick) => recordError(aggregateErrors, total, reference.total[tick]!));
    trace.aggregateErrors = aggregateErrors;
  }
  trace.elapsedMs = performance.now() - started;
  return { observations: cells.map(cell => observations.get(cell.component)!), trace };
}
