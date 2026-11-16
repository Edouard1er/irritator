import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LevelTwoJourney } from '@/components/workshop/level-two-journey';
import { GeoAtlasWorkspace } from '@/components/territory/geo-atlas-workspace';
import { TerritoryWorkspace } from '@/components/territory/territory-workspace';
import { mapToTerritory } from '@/lib/modeling/geo-to-territory';
import { visibleFeaturesForContext } from '@/lib/workshop/atlas-visibility';
import type { AtlasController } from '@/lib/workshop/geo-atlas';
import { parseGeoAtlas, geoAtlasStorageKey } from '@/lib/serialization/geo-atlas';
import initial from '@/data/geography/lac-de-guiers.atlas.json';
import model from '../../../examples/atelier-interventions-month-v3.json';
import type { GeoAtlasV1 } from '../../../packages/contracts/geo-atlas';
import { applyTerritorialZone, type RunRequest } from '@contracts';

// Fictitious privacy sentinels, never field data or a calibration.
function fixture() {
  const a = structuredClone(initial) as GeoAtlasV1;
  a.sources.push({id:'test-private',title:'SourceSecretGamma',organization:'Fixture fictive',classification:'workshop-declaration'});
  a.features.push(
    {type:'Feature',id:'private-point',geometry:{type:'Point',coordinates:[-15.84321,16.12345]},properties:{name:'RepèreSecretAlpha',description:'DescriptionSecretAlpha',kind:'fishing-point',sourceId:'test-private',evidence:'declared-unverified',precision:'approximate',share:'workshop-only',recordedAt:a.updatedAt}},
    {type:'Feature',id:'private-sector',geometry:{type:'Polygon',coordinates:[[[-15.84,16.1],[-15.83,16.1],[-15.83,16.11],[-15.84,16.1]]]},properties:{name:'SecteurSecretBeta',kind:'fishing-area',sourceId:'test-private',evidence:'declared-unverified',precision:'approximate',share:'workshop-only',recordedAt:a.updatedAt}}
  );
  return parseGeoAtlas(JSON.stringify(a));
}
let controller: AtlasController;
const request = model as unknown as RunRequest;
const click = (name:string|RegExp) => fireEvent.click(screen.getByRole('button',{name}));
const reading = (name:string) => fireEvent.click(within(screen.getByRole('group',{name:'Lecture de l’atelier'})).getByRole('button',{name}));
const absent = () => {expect(document.body.innerHTML).not.toMatch(/RepèreSecretAlpha|SecteurSecretBeta|DescriptionSecretAlpha|SourceSecretGamma|private-point|private-sector|-15.84321|BrouillonSecret/);};
function mount() {
  return render(<LevelTwoJourney request={request} busy={false} onRun={vi.fn()} onAudience={vi.fn()} simulation={()=>null}
    territory={(_,scientific,_next,_show,c)=>{controller=c;return <GeoAtlasWorkspace controller={c} scientific={scientific} request={request} busy={false} onApply={vi.fn()}/>;}}/>);
}
function loadPrivate() {
  reading('Scientifique');
  act(()=>{controller.setAuthorized(true);controller.setPending(fixture());});
  act(()=>controller.replace());
  fireEvent.click(screen.getByRole('checkbox',{name:/Afficher les lieux privés/}));
  expect(screen.getByRole('button',{name:'RepèreSecretAlpha'})).toBeVisible();
}
beforeEach(()=>{localStorage.clear();vi.spyOn(window,'confirm').mockReturnValue(true);});

it('PRIV-01 removes point, sector, selection, descriptions, SVG and ARIA from public DOM without deleting',()=>{
  mount();loadPrivate();click('RepèreSecretAlpha');const before=JSON.stringify(controller.atlas);reading('Pêcheur');absent();expect(JSON.stringify(controller.atlas)).toBe(before);expect(controller.privateView).toBe(false);
});
it('PRIV-02 requires a fresh private opt-in on returning to scientific reading',()=>{
  mount();loadPrivate();reading('Pêcheur');reading('Scientifique');absent();fireEvent.click(screen.getByRole('checkbox',{name:/Afficher les lieux privés/}));expect(screen.getByText(/DescriptionSecretAlpha/)).toBeInTheDocument();
});
it('PRIV-03 applies the same policy to S2 and the retained first-step DOM',()=>{
  mount();loadPrivate();reading('Pêcheur');reading('Scientifique');fireEvent.change(screen.getByLabelText('Situation de discussion'),{target:{value:'S2-reserve'}});reading('Pêcheur');fireEvent.click(within(screen.getByRole('navigation',{name:'Étapes de l’atelier'})).getByRole('button',{name:/Voyons ce qui se passe/}));absent();expect(document.querySelectorAll('.journey-presentation .geo-point')).toHaveLength(0);
});
it('PRIV-04 filters projection in its first render, even with a stale private opt-in',()=>{
  const a=fixture();const before=JSON.stringify(a);expect(visibleFeaturesForContext(a,{audience:'scientific',projection:true,privateWorkspaceOptIn:true}).some(f=>f.properties.evidence==='declared-unverified')).toBe(false);expect(JSON.stringify(a)).toBe(before);
  mount();loadPrivate();act(()=>controller.setProjection(true));absent();expect(controller.privateView).toBe(false);
});
it('PRIV-05 export review is not current diffusion consent; revocation suspends private access',()=>{
  const a=fixture();a.features.at(-1)!.properties.share='exportable-with-review';expect(visibleFeaturesForContext(a,{audience:'fisher',projection:false,privateWorkspaceOptIn:true}).some(f=>f.id==='private-sector')).toBe(false);
  mount();loadPrivate();act(()=>controller.setAuthorized(false));absent();expect(controller.atlas.features).toHaveLength(a.features.length);
});
it('PRIV-06 corrections and original history stay private and intact',()=>{
  mount();loadPrivate();act(()=>controller.update(a=>{const f=structuredClone(a.features.find(f=>f.id==='private-point')!);f.id='correction-private';f.properties.name='RepèreSecretAlpha corrigé';f.properties.supersedesId='private-point';a.features.push(f);}));click('RepèreSecretAlpha corrigé');reading('Pêcheur');absent();expect(controller.atlas.features.find(f=>f.id==='correction-private')!.properties.supersedesId).toBe('private-point');
});
it('PRIV-07 suspends unconfirmed draft vertices and text, then resumes only in private workspace',()=>{
  mount();loadPrivate();click('Indiquer un endroit');fireEvent.change(screen.getByLabelText('Comment appelez-vous ce lieu ?'),{target:{value:'BrouillonSecret'}});fireEvent.keyDown(screen.getByRole('group',{name:/Placer sur la carte/}),{key:'Enter'});reading('Pêcheur');absent();expect(document.querySelectorAll('.geo-draft')).toHaveLength(0);reading('Scientifique');absent();fireEvent.click(screen.getByRole('checkbox',{name:/Afficher les lieux privés/}));expect(screen.getByLabelText('Comment appelez-vous ce lieu ?')).toHaveValue('BrouillonSecret');
});
it('PRIV-08 restore/import retains the archive and resets all private rendering rights',()=>{
  const raw=JSON.stringify(fixture());localStorage.setItem(geoAtlasStorageKey,raw);mount();reading('Scientifique');act(()=>controller.setAuthorized(true));act(()=>controller.restore());act(()=>controller.replace());absent();expect(controller.privateView).toBe(false);reading('Pêcheur');absent();expect(localStorage.getItem(geoAtlasStorageKey)).toBe(raw);
});

it('PRIV linked model: a copied atlas sector and activity context cannot re-expose its name or polygon',()=>{
  const atlas=fixture(),copied=mapToTerritory(atlas,'private-sector',.2,'Hypothèse fictive',true,true),applied=applyTerritorialZone(request,copied,'private-sector');
  render(<LevelTwoJourney request={applied} busy={false} onRun={vi.fn()} onAudience={vi.fn()} simulation={()=>null} territory={(_,scientific,_next,_show,c)=>{controller=c;return <TerritoryWorkspace request={applied} atlasController={c} journeyStep="zone" journeyScientific={scientific} busy={false} onApply={vi.fn()} onSimulation={vi.fn()}/>;}}/>);
  absent();reading('Scientifique');absent();act(()=>{controller.setAuthorized(true);controller.setPending(atlas);});act(()=>controller.replace());fireEvent.click(screen.getByRole('checkbox',{name:/Afficher les lieux privés/}));expect(document.body.innerHTML).toContain('SecteurSecretBeta');reading('Pêcheur');absent();expect(applied.territory!.geography.features[0]!.properties.name).toBe('SecteurSecretBeta');
});
