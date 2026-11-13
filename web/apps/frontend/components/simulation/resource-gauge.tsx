import { statusInfo, type AlertConfig, type BiomassStatus } from '@/lib/simulation/trajectory';
const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n);
export function ResourceGauge({ value, unit, capacity, config, trend, state }: { value?: number; unit: string; capacity?: number; config: AlertConfig; trend?: number; state: BiomassStatus }) {
  const crit = config.bCrit, upper = crit === undefined ? undefined : crit*(1+config.proximityRatio);
  const max = Math.max(value ?? 0, capacity ?? 0, upper ?? 0, 1)*1.08;
  const x = (n: number) => 34+Math.max(0,n)/max*532;
  const direction = trend === undefined ? 'Tendance inconnue' : trend < -config.slopeTolerance ? '↘ Baisse' : trend > config.slopeTolerance ? '↗ Hausse' : '→ Stable';
  return <article className={`workshop-card resource-gauge status-${state}`}><h2>Où en est la ressource ?</h2>
    <div className="gauge-summary"><strong>{value === undefined ? 'Non disponible' : `${fmt(value)} ${unit}`}</strong><span>{direction}</span></div>
    <svg viewBox="0 0 600 180" role="img" aria-label={`Biomasse ${value ?? 'inconnue'} ${unit}, seuil ${crit ?? 'non défini'}, limite d’alerte ${upper ?? 'non définie'}, capacité K ${capacity ?? 'non disponible'}`}>
      <defs><linearGradient id="gauge-shine" x2="0" y2="1"><stop stopColor="#fff" stopOpacity=".4"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient></defs>
      <rect x="34" y="75" width="532" height="26" rx="13" fill="#deebe8" />
      {crit !== undefined && upper !== undefined && <><rect x="34" y="75" width={x(crit)-34} height="26" rx="13" fill="#ce5063"/><rect x={x(crit)} y="75" width={x(upper)-x(crit)} height="26" fill="#eea550"/><rect x={x(upper)} y="75" width={566-x(upper)} height="26" fill="#8cc9aa"/></>}
      <rect x="34" y="75" width="532" height="26" rx="13" fill="url(#gauge-shine)" />
      {[{ n: 0, label: '0', row: 0 }, ...(crit === undefined ? [] : [{n:crit,label:`Seuil ${fmt(crit)}`,row:0}]), ...(upper === undefined ? [] : [{n:upper,label:`Alerte ${fmt(upper)}`,row:1}]), ...(capacity === undefined ? [] : [{n:capacity,label:`K ${fmt(capacity)}`,row:0}])].map((mark,i) => <g key={i}><path d={`M ${x(mark.n)} 103 v ${mark.row ? 30 : 12}`} stroke="#4c6673"/><text x={x(mark.n)} y={mark.row ? 151 : 128} textAnchor={mark.n===0?'start':'middle'} fontSize="13" fill="#385566">{mark.label}</text></g>)}
      {value !== undefined && Number.isFinite(value) && <g data-biomass={value}><path d={`M ${x(value)} 73 v -18`} stroke={statusInfo[state].color} strokeWidth="3"/><circle cx={x(value)} cy="55" r="10" fill={statusInfo[state].color} stroke="white" strokeWidth="3"/><text x={Math.min(530,Math.max(70,x(value)))} y="29" textAnchor="middle" fontSize="16" fontWeight="700" fill={statusInfo[state].color}>B = {fmt(value)} {unit}</text></g>}
    </svg>
    <div className="gauge-legend"><span><i style={{background:'#ce5063'}}/>Danger</span><span><i style={{background:'#eea550'}}/>Alerte</span><span><i style={{background:'#8cc9aa'}}/>Au-dessus de l’alerte</span></div>
    <p>{crit === undefined ? 'Définir le seuil d’atelier pour afficher les zones.' : 'Seuil d’atelier : hypothèse pédagogique, sans validation écologique.'}{capacity === undefined ? ' K non disponible.' : ` K = ${fmt(capacity)} ${unit}.`}</p>
  </article>;
}
