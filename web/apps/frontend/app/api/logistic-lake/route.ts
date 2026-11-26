import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lakeDomain } from '../../../../../examples/logistic-grid';
import { lakeReference } from '../../../../../examples/logistic-lake-analysis';
import { lakeExchangeDomain, lakeExchangeIntensities, lakeExchangeResolutions } from '../../../../../examples/logistic-lake-exchange';
import { lakeNetworkDomain, type LakeNetworkInputs } from '../../../../../examples/logistic-lake-network';
import { lakeGradientProfiles, lakeMaxAlpha, lakeMeshFromGeoJson, lakeResolutionId, lakeResolutions } from '../../../../../examples/logistic-lake';
import type { LakeExchangePlan, LakeNetworkPlan, LakePlan } from '../../../../../examples/logistic-lake-run';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const resolution = lakeResolutions.find(size => lakeResolutionId(size) === query.get('resolution'));
  const kind = query.get('distribution');
  const rawProfile = query.get('profile');
  const profile = lakeGradientProfiles.find(candidate => candidate === rawProfile);
  const rawAlpha = query.get('alpha');
  const alpha = Number(rawAlpha);
  const a = query.get('a');
  const b = query.get('b');
  const networkCells = query.get('cells');
  const networkEdges = query.getAll('edge');
  const networked = networkCells !== null || networkEdges.length > 0;
  const rawMu = query.get('mu');
  const paired = a !== null || b !== null || (!networked && rawMu !== null);
  const mu = lakeExchangeIntensities.find(value => String(value) === rawMu);
  if (!resolution || (kind !== 'homogeneous' && kind !== 'gradient' && kind !== 'wet-gradient') ||
    (rawProfile !== null && (!profile || kind === 'homogeneous')) ||
    (kind !== 'homogeneous' && (!rawAlpha?.trim() || !Number.isFinite(alpha) || alpha < 0 || alpha > lakeMaxAlpha))) {
    return Response.json({ message: 'Résolution, distribution, profil ou intensité du gradient invalide.' }, { status: 400 });
  }
  if (paired && (!a || !b || mu === undefined || !lakeExchangeResolutions.some(size => size === resolution))) {
    return Response.json({ message: 'Paire, résolution ou intensité d’échange invalide.' }, { status: 400 });
  }
  if (networked && (paired || !networkCells || mu === undefined || !lakeExchangeResolutions.some(size => size === resolution))) {
    return Response.json({ message: 'Réseau, résolution ou intensité d’échange invalide.' }, { status: 400 });
  }

  const source = await readFile(resolve('data/geography/lac-de-guiers.hydrolakes.geojson'), 'utf8');
  const mesh = lakeMeshFromGeoJson(JSON.parse(source), resolution);
  const domain = lakeDomain(mesh, 'proportional', kind === 'homogeneous' ? { kind }
    : { kind, alpha, ...(profile ? { profile } : {}) });
  try {
    if (a && b && mu !== undefined) {
      return Response.json({ mesh, domain: lakeExchangeDomain(mesh, domain, { a, b, mu }) } satisfies LakeExchangePlan);
    }
    if (networkCells && mu !== undefined) {
      const edges = networkEdges.map(edge => {
        const [first, second, ...rest] = edge.split(',');
        if (!first || !second || rest.length) throw new RangeError('Une arête doit indiquer ses deux cellules.');
        return [first, second] as const;
      });
      const inputs: LakeNetworkInputs = { cells: networkCells.split(','), edges, mu };
      return Response.json({ mesh, domain: lakeNetworkDomain(mesh, domain, inputs) } satisfies LakeNetworkPlan);
    }
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    return Response.json({ message: cause.message }, { status: 400 });
  }
  return Response.json({ mesh, domain, reference: lakeReference(domain) } satisfies LakePlan);
}
