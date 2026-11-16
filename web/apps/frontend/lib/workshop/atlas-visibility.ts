import { activeGeoFeatures, type GeoAtlasV1 } from '../../../../packages/contracts/geo-atlas';

export type AtlasViewContext = {
  audience: 'fisher' | 'scientific';
  projection: boolean;
  privateWorkspaceOptIn: boolean;
};

// Collection consent and a saved export review never grant current public diffusion.
// Until a separate, current diffusion workflow exists, declarations stay private.
export function privateAtlasWorkspace(context: AtlasViewContext): boolean {
  return context.audience === 'scientific' && !context.projection && context.privateWorkspaceOptIn;
}

export function visibleFeaturesForContext(atlas: GeoAtlasV1, context: AtlasViewContext) {
  const privateWorkspace = privateAtlasWorkspace(context);
  return activeGeoFeatures(atlas).filter(feature => {
    const source = atlas.sources.find(s => s.id === feature.properties.sourceId);
    return !!source && source.classification !== 'fictional-demo' &&
      (source.classification !== 'workshop-declaration' && feature.properties.evidence !== 'declared-unverified' || privateWorkspace);
  });
}
