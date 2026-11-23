import { parseResult, type RunRequest, type RunResult } from '../packages/contracts/index.js';
import type { LakeDomain } from './logistic-grid.js';

type BatchTrace = {
  modelId: string;
  runId?: string;
  elapsedMs: number;
  cells: number;
  runCalls: number;
  points: number;
  resultBytes: number;
  errors: NumericalErrors;
};

type NumericalErrors = { maxAbsoluteTonnes: number; maxRelative: number };
const emptyErrors = (): NumericalErrors => ({ maxAbsoluteTonnes: 0, maxRelative: 0 });

export type LakeRunTrace = {
  parameters: LakeDomain['parameters'];
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

export async function runLakeSimulation(domain: LakeDomain, execute: (request: RunRequest) => Promise<unknown>, options: {
  signal?: AbortSignal;
  onProgress?: (completed: number) => void;
} = {}) {
  const { parameters, cells, batches } = domain;
  const { signal, onProgress } = options;
  const { start, end } = parameters.simulation;
  const ticks = Math.round((end - start) / parameters.samplingInterval) + 1;
  // Analytical reference for diagnostics only. Displayed samples all come from the runner.
  const ratios = Array.from({ length: ticks }, (_, tick) =>
    1 / (1 + (parameters.capacityDensity / parameters.initialDensity - 1) * Math.exp(-parameters.growth * tick * parameters.samplingInterval)));
  const totals = new Float64Array(ticks);
  const totalCapacity = parameters.areaKm2 * parameters.capacityDensity;
  const observations: RunResult['observations'] = [];
  const encoder = new TextEncoder();
  const started = performance.now();
  const trace: LakeRunTrace = {
    parameters, startedAt: new Date().toISOString(), elapsedMs: 0, wetCells: cells.length,
    plannedBatches: batches.length, batches: [], points: 0, resultBytes: 0,
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
        const cell = members[index]!;
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
          recordError(errors, value, cell.capacity * ratios[tick]!);
          totals[tick] = totals[tick]! + value;
        }
      }
      const points = result.observations.length * ticks;
      trace.batches.push({ modelId: result.modelId, ...(typeof runId === 'string' ? { runId } : {}),
        elapsedMs: performance.now() - batchStarted, cells: members.length, runCalls: result.simulation.runCalls,
        points, resultBytes, errors });
      trace.points += points;
      trace.resultBytes += resultBytes;
      localErrors.maxAbsoluteTonnes = Math.max(localErrors.maxAbsoluteTonnes, errors.maxAbsoluteTonnes);
      localErrors.maxRelative = Math.max(localErrors.maxRelative, errors.maxRelative);
      trace.localErrors = localErrors;
      observations.push(...result.observations);
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

  const aggregateErrors = emptyErrors();
  totals.forEach((total, tick) => recordError(aggregateErrors, total, totalCapacity * ratios[tick]!));
  trace.aggregateErrors = aggregateErrors;
  trace.elapsedMs = performance.now() - started;
  return { observations, trace };
}
