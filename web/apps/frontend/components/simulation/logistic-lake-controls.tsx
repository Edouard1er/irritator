import { useState } from 'react';
import { Download } from 'lucide-react';
import { lakeDefaultGradientProfile, lakeDistributionId, lakeGradientProfiles, lakeMaxAlpha } from '@/lib/simulation/spatial-experiment';
import { lakeAlpha, lakeDistributionOptions, lakeProfileLabels, type LakeInputs } from '@/lib/simulation/lake-exploration';
import { downloadLakeFile, lakeSvgToPng, lakeViewSvg, type LakeViewSnapshot } from '@/lib/simulation/lake-view-export';
import styles from './logistic-spatial.module.css';

type Distribution = Omit<LakeInputs, 'resolution'>;

export function DistributionInputs({ inputs, applied, change, label, profileLabel, intensityLabel }: {
  inputs: Distribution;
  applied?: Distribution;
  change: (value: Distribution) => void;
  label: string;
  profileLabel: string;
  intensityLabel: string;
}) {
  return <>
    <label className={styles.dimensions}>{label}
      <select value={inputs.kind} onChange={event => {
        const option = lakeDistributionOptions.find(({ kind }) => kind === event.currentTarget.value);
        if (option) change({ ...inputs, kind: option.kind });
      }}>
        {lakeDistributionOptions.map(({ kind, label }) => <option key={kind} value={kind}>{label}</option>)}
      </select>
    </label>
    {inputs.kind !== 'homogeneous' && <>
      <label className={styles.dimensions}>{profileLabel}
        <select value={inputs.profile ?? lakeDefaultGradientProfile} onChange={event => {
          const profile = lakeGradientProfiles.find(candidate => candidate === event.currentTarget.value);
          if (profile) change({ ...inputs, profile });
        }}>
          {lakeGradientProfiles.map(profile => <option key={profile} value={profile}>{lakeProfileLabels[profile]}</option>)}
        </select>
      </label>
      <label className={styles.gradientIntensity}>
        <span>{intensityLabel} proposée <strong>{lakeAlpha(inputs.alpha)}</strong></span>
        <input type="range" min={0} max={lakeMaxAlpha} step={0.01} value={inputs.alpha}
          aria-label={intensityLabel} aria-valuetext={lakeAlpha(inputs.alpha)}
          onChange={event => change({ ...inputs, alpha: Number(event.currentTarget.value) })} />
        <small>{applied && applied.kind !== 'homogeneous'
          ? `Intensité simulée α = ${lakeAlpha(applied.alpha)}` : 'Aucun gradient simulé pour cette carte'}</small>
      </label>
    </>}
    {applied && applied.kind !== 'homogeneous' && <small>
      Profil simulé · {lakeProfileLabels[applied.profile ?? lakeDefaultGradientProfile]}
    </small>}
  </>;
}

export function RunProgress({ progress, cancel, workshop }: { progress: { done: number; count?: number }; cancel: () => void; workshop?: boolean }) {
  return <>
    {progress.count === undefined ? <span>Préparation du scénario…</span> : <label className={styles.progress}>
      <progress value={progress.done} max={progress.count} />
      <span aria-live="polite">{workshop ? 'Simulation en cours' : `${progress.done} / ${progress.count} lots natifs`}</span>
    </label>}
    <button type="button" onClick={cancel}>Annuler le calcul</button>
  </>;
}

export function LakeExport({ snapshot, resolution }: { snapshot?: LakeViewSnapshot; resolution: string }) {
  const [format, setFormat] = useState<'svg' | 'png'>('svg');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  async function exportView() {
    if (!snapshot || busy) return;
    setFailure('');
    setBusy(true);
    try {
      const svg = new Blob([lakeViewSvg(snapshot)], { type: 'image/svg+xml;charset=utf-8' });
      const file = format === 'svg' ? svg : await lakeSvgToPng(svg);
      const scenarios = snapshot.maps.map(({ dataset }) => lakeDistributionId(dataset.trace.parameters.distribution));
      const suffix = scenarios.length === 2 ? `-comparaison-${scenarios.join('-')}` : scenarios[0] === 'homogeneous' ? '' : `-${scenarios[0]}`;
      const exchange = snapshot.maps.find(map => map.dataset.trace.exchange)?.dataset.trace.exchange;
      const network = snapshot.maps.find(map => map.dataset.trace.network)?.dataset.trace.network;
      const coupling = network ? `-reseau-${network.cells.join('-')}-mu-${network.mu}`
        : exchange ? `-echange-${exchange.a}-${exchange.b}-mu-${exchange.mu}` : '';
      const name = `lac-de-guiers-${resolution}-mois-${snapshot.time}${suffix}${coupling}`;
      downloadLakeFile(file, `${name}.${format}`);
    } catch {
      setFailure('Impossible d’exporter l’image. Réessayez au format SVG.');
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.lakeExport}>
    <button type="button" disabled={!snapshot || busy} onClick={() => void exportView()}>
      <Download size={15} aria-hidden="true" /> Exporter cette vue
    </button>
    <select aria-label="Format de l’image" value={format} disabled={busy}
      onChange={event => setFormat(event.currentTarget.value === 'png' ? 'png' : 'svg')}>
      <option value="svg">SVG</option><option value="png">PNG</option>
    </select>
    {failure && <span role="alert">{failure}</span>}
  </div>;
}
