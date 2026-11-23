import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { lakeDomain } from '../../dist/examples/logistic-grid.js';
import { lakeReference } from '../../dist/examples/logistic-lake-analysis.js';
import { lakeContinuumFromGeoJson, lakeContinuumParameters } from '../../dist/examples/logistic-lake-continuum.js';
import { runLakeBatches } from '../../dist/examples/logistic-lake-run.js';
import { lakeMeshFromGeoJson, lakeResolutionId, lakeResolutions } from '../../dist/examples/logistic-lake.js';

export const lakeContour = new URL('../../apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson', import.meta.url);
const checkpointsMonths = [0, 10, 20];

function spatialError(totals, continuum, dates, interval) {
  const differences = totals.map((total, i) => total - continuum[i]);
  const maxAbsoluteTonnes = Math.max(...differences.map(Math.abs));
  const peak = differences.findIndex(value => Math.abs(value) === maxAbsoluteTonnes);
  return {
    maxAbsoluteTonnes,
    maxRelative: Math.max(...differences.map((difference, i) => Math.abs(difference) / continuum[i])),
    monthOfMaxAbsolute: Number(dates[peak].toFixed(1)),
    signedTonnesAtMaxAbsolute: differences[peak],
    signedTonnesAtCheckpoints: checkpointsMonths.map(month => differences[Math.round(month / interval)]),
  };
}

export function compareLakeMeshes(source) {
  const parameters = lakeContinuumParameters;
  const { horizonMonths, samplingIntervalMonths } = parameters;
  const dates = Array.from({ length: Math.round(horizonMonths / samplingIntervalMonths) + 1 }, (_, i) => i * samplingIntervalMonths);
  const meshes = lakeResolutions.map(resolution => lakeMeshFromGeoJson(source, resolution));
  const { trajectory, ...geometry } = lakeContinuumFromGeoJson(source);
  const intensities = [0, 0.3, 0.6].map(alpha => {
    const standard = trajectory(alpha, dates);
    const { totalsTonnes, ...precision } = trajectory(alpha, dates, 1e-10);
    const continuum = {
      ...precision,
      standardToleranceTonnes: standard.toleranceTonnes,
      standardPanelsPerBand: standard.refinements.at(-1).panelsPerBand,
      maxDifferenceFromStandardTonnes: Math.max(...totalsTonnes.map((value, i) => Math.abs(value - standard.totalsTonnes[i]))),
      totalsTonnes,
    };
    const distributions = alpha === 0 ? [{ kind: 'homogeneous' }]
      : [{ kind: 'gradient', alpha }, { kind: 'wet-gradient', alpha }];
    const previous = new Map();
    const resolutions = meshes.map(mesh => ({
      grid: lakeResolutionId(mesh),
      wetCells: mesh.cells.length,
      cases: distributions.map(distribution => {
        const domain = lakeDomain(mesh, 'proportional', distribution);
        const { local } = lakeReference(domain);
        // Sum the cell solutions even for alpha=0, where lakeReference.total
        // normally uses the exact aggregate formula to preserve historical traces.
        const total = dates.map((_, i) => local.reduce((sum, cell) => sum + cell[i], 0));
        const spatial = spatialError(total, totalsTonnes, dates, samplingIntervalMonths);
        const previousError = previous.get(distribution.kind);
        const ratio = alpha > 0 && previousError !== undefined && spatial.maxAbsoluteTonnes > 0
          ? previousError / spatial.maxAbsoluteTonnes : null;
        previous.set(distribution.kind, spatial.maxAbsoluteTonnes);
        return { domain, reference: { local, total }, distribution: distribution.kind,
          spatial: { ...spatial, previousMaxAbsoluteOverCurrent: ratio } };
      }),
    }));
    return { alpha, continuum, resolutions };
  });
  return { parameters, dates, checkpointsMonths, geometry, intensities };
}

function executeNative(runner, request) {
  const result = spawnSync(runner, [], { input: JSON.stringify(request), encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Runner arrêté (${result.status}).`);
  return JSON.parse(result.stdout);
}

async function writeEvidence(output, runner) {
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const runnerSha256 = sha256(readFileSync(runner));
  const geojson = readFileSync(lakeContour);
  const { dates, intensities, ...analysis } = compareLakeMeshes(JSON.parse(geojson));
  const evidence = { geojsonSha256: sha256(geojson), runnerSha256, ...analysis,
    datesMonths: dates.map(time => Number(time.toFixed(1))), intensities: [] };
  for (const { alpha, continuum, resolutions } of intensities) {
    const rows = [];
    for (const { grid, wetCells, cases } of resolutions) {
      const measurements = [];
      for (const { domain, reference, distribution, spatial } of cases) {
        const { trace } = await runLakeBatches(domain, reference, async request => executeNative(runner, request));
        measurements.push({ distribution, spatial, qss3: {
          local: trace.localErrors, aggregate: trace.aggregateErrors,
        } });
      }
      rows.push({ grid, wetCells, cases: measurements });
    }
    evidence.intensities.push({ alpha, continuum, resolutions: rows });
  }
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
}

if (import.meta.main) {
  const output = process.argv[2];
  const runner = process.env.IRRITATOR_RUNNER;
  if (!runner || !output) throw new Error('Définir IRRITATOR_RUNNER et fournir le chemin du fichier JSON en argument.');
  await writeEvidence(output, runner);
}
