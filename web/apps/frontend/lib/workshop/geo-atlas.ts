'use client';
import { useEffect, useRef, useState } from 'react';
import { validateGeoAtlas, type GeoAtlasV1 } from '../../../../packages/contracts/geo-atlas';
import { geoAtlasStorageKey, parseGeoAtlas, saveGeoAtlas } from '@/lib/serialization/geo-atlas';
import { errorText } from '@/lib/api/client';
import initialAtlas from '@/data/geography/lac-de-guiers.atlas.json';
export function useGeoAtlas() {
  const [atlas,setAtlas]=useState<GeoAtlasV1>(()=>{ const a=structuredClone(initialAtlas); validateGeoAtlas(a); return a; });
  const [authorized,setAuthorized]=useState(false), [privateView,setPrivateView]=useState(false);
  const [error,setError]=useState(''), [message,setMessage]=useState('Exercice éphémère : les lieux restent en mémoire jusqu’à la fermeture de la page.');
  const [restoreAvailable,setRestoreAvailable]=useState(false), [pending,setPending]=useState<GeoAtlasV1>();
  const blocked=useRef(false);
  useEffect(()=>{ try { blocked.current=!!localStorage.getItem(geoAtlasStorageKey); setRestoreAvailable(blocked.current); if (blocked.current) setMessage('Une carte locale est disponible. Restaurez-la avant de la sauvegarder.'); } catch { blocked.current=true; setError('Stockage cartographique indisponible.'); } },[]);
  const attempt=(action:()=>void)=>{ try { action(); setError(''); } catch(e) { setError(errorText(e)); } };
  const update=(mutate:(next:GeoAtlasV1)=>void)=>attempt(()=>{
    const next=structuredClone(atlas); mutate(next); next.revision++; next.updatedAt=new Date().toISOString(); validateGeoAtlas(next); setAtlas(next); setMessage('Indication conservée en mémoire pour la discussion ; aucune limite officielle. Sauvegarde séparée par l’animateur.');
  });
  const save=()=>attempt(()=>{ if(blocked.current) throw new Error('Restaurez la carte locale avant de sauvegarder ; l’archive existante est conservée.'); saveGeoAtlas(localStorage,atlas,authorized); setRestoreAvailable(true); setMessage('Carte sauvegardée dans ce navigateur ; aucune transmission réseau.'); });
  const restore=()=>attempt(()=>{ const raw=localStorage.getItem(geoAtlasStorageKey); if(!raw) throw new Error('Aucune carte locale.'); const next=parseGeoAtlas(raw); if(next.features.some(f=>next.sources.find(s=>s.id===f.properties.sourceId)?.classification==='workshop-declaration')&&!authorized) throw new Error('Confirmez l’autorisation cartographique avant de restaurer les lieux privés.'); setPending(next); });
  const replace=()=>attempt(()=>{ if(!pending) return; if(!window.confirm('Remplacer la carte en mémoire ? Exportez d’abord les versions à conserver. Le modèle et les décisions restent séparés.')) return; if(pending.features.some(f=>pending.sources.find(s=>s.id===f.properties.sourceId)?.classification==='workshop-declaration')&&!authorized) throw new Error('Autorisation cartographique requise pour importer des déclarations.'); setAtlas(pending); setPending(undefined); blocked.current=false; setPrivateView(false); setMessage('Carte chargée en mémoire. Vérifiez les lieux avant projection ; sauvegarde séparée.'); });
  return {atlas,authorized,setAuthorized,privateView,setPrivateView,error,setError,message,setMessage,restoreAvailable,pending,setPending,update,save,restore,replace};
}
export type AtlasController=ReturnType<typeof useGeoAtlas>;
