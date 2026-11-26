import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lakeDomain } from '../../../../../examples/logistic-grid';
import { lakeReference } from '../../../../../examples/logistic-lake-analysis';
import { lakeGradientProfiles, lakeMaxAlpha, lakeMeshFromGeoJson, lakeResolutionId, lakeResolutions } from '../../../../../examples/logistic-lake';
import type { LakePlan } from '../../../../../examples/logistic-lake-run';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const resolution = lakeResolutions.find(size => lakeResolutionId(size) === query.get('resolution'));
  const kind = query.get('distribution');
  const rawProfile = query.get('profile');
  const profile = lakeGradientProfiles.find(candidate => candidate === rawProfile);
  const rawAlpha = query.get('alpha');
  const alpha = Number(rawAlpha);
  if (!resolution || (kind !== 'homogeneous' && kind !== 'gradient' && kind !== 'wet-gradient') ||
    (rawProfile !== null && (!profile || kind === 'homogeneous')) ||
    (kind !== 'homogeneous' && (!rawAlpha?.trim() || !Number.isFinite(alpha) || alpha < 0 || alpha > lakeMaxAlpha))) {
    return Response.json({ message: 'Résolution, distribution, profil ou intensité du gradient invalide.' }, { status: 400 });
  }

  const source = await readFile(resolve('data/geography/lac-de-guiers.hydrolakes.geojson'), 'utf8');
  const mesh = lakeMeshFromGeoJson(JSON.parse(source), resolution);
  const domain = lakeDomain(mesh, 'proportional', kind === 'homogeneous' ? { kind }
    : { kind, alpha, ...(profile ? { profile } : {}) });
  return Response.json({ mesh, domain, reference: lakeReference(domain) } satisfies LakePlan);
}
