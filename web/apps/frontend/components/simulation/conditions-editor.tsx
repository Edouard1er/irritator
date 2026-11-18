'use client';
import {useMemo,useState} from 'react';
import {conditionsAt,conditionKeys,conditionUnits,validateConditions,type Conditions,type RunRequest,type TemporalExperiment} from '@contracts';
import {exportPracticeHistory,importPracticeHistory,initialReferencePractice,importEffortConfiguration,nominalFishingEffort,normalizeFishingEffort,practiceAt,type FishingPractice,type PracticeHistory} from '@/lib/simulation/fishing-effort';
import {downloadFile} from '@/lib/serialization/workspace';

const labels:Record<keyof Conditions,string>={r0:'Croissance de référence r₀',q0:'Capturabilité de référence q₀',S:'Salinité',Sopt:'Salinité optimale Sopt',ks:'Sensibilité ks',P:'Pluie',betaP:'Influence de la pluie βp',a:'Accessibilité',E:'Effort du modèle',spring:'Coefficient printemps',summer:'Coefficient été',autumn:'Coefficient automne',winter:'Coefficient hiver'};
const fmt=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(n);
export function ConditionsEditor({experiment,request,history:initialHistory,time,scientific,busy,onApply,onCancel}:{
  experiment:TemporalExperiment;request:RunRequest;history:PracticeHistory;time:number;scientific:boolean;busy:boolean;
  onApply:(p:Conditions,practice:FishingPractice,history:PracticeHistory)=>void;onCancel:()=>void;
}) {
  const [p,setP]=useState(()=>conditionsAt(experiment,time));
  const [history,setHistory]=useState(initialHistory);
  const [practice,setPractice]=useState<FishingPractice>(()=>practiceAt(initialHistory,experiment,time)??{...initialReferencePractice});
  const [fileError,setFileError]=useState('');
  const [confirmHabit,setConfirmHabit]=useState(true);
  const needsHabit=!history.habitualPractice||history.habitualPractice.tripsPerWeek===0;
  const computed=useMemo(()=>{
    try {validateConditions(p);return {effort:normalizeFishingEffort(practice,history.reference,p,history.configuration),error:''};}
    catch(e){return {effort:undefined,error:(e as Error).message};}
  },[p,practice,history]);
  const nominal=useMemo(()=>{try{return nominalFishingEffort(practice);}catch{return undefined;}},[practice]);
  const referenceNominal=useMemo(()=>{try{return nominalFishingEffort(history.reference.practice);}catch{return undefined;}},[history]);
  const update=(key:keyof Conditions,value:string)=>setP(prev=>({...prev,[key]:value===''?NaN:Number(value)}));
  const numberField=(key:keyof FishingPractice,label:string,min:number,integer=false)=><label>{label}<input aria-label={label} type="number" min={min} step={integer?1:'any'} required value={typeof practice[key]==='number'&&Number.isFinite(practice[key])?(key==='tripsPerWeek'?Number((practice[key] as number).toFixed(6)):practice[key]):''} onChange={e=>setPractice(prev=>({...prev,[key]:e.target.value===''?NaN:Number(e.target.value)}))}/></label>;
  const selectField=(key:keyof FishingPractice,label:string,options:[string,string][])=><label>{label}<select aria-label={label} value={String(practice[key]??'')} onChange={e=>setPractice(prev=>({...prev,[key]:e.target.value}))}>{options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>;

  return <form className="conditions-editor" aria-label="Conditions de l’intervention" onSubmit={e=>{e.preventDefault();if(!busy&&computed.effort&&!computed.error&&!fileError)onApply({...p,E:computed.effort.modelEffort},practice,needsHabit&&confirmHabit?{...history,habitualPractice:structuredClone(practice)}:history);}}>
    <div className="conditions-title"><div><h2>Modifier les conditions au mois {Number(time.toFixed(8))}</h2>{scientific&&<p>Lecture en pause. N et C restent des états continus du moteur ; recalcul depuis l’origine.</p>}</div><button type="button" onClick={onCancel} disabled={busy}>Annuler</button></div>
    <fieldset disabled={busy}><legend>Conditions du lac</legend><div className="condition-controls">{(['P','S','a'] as const).map(key=><label key={key} htmlFor={'condition-'+key}>{labels[key]} <span className="condition-value" aria-hidden="true">{key==='a'?Math.round(p[key]*100):p[key]}{key==='a'?' %':' / 10'}</span><input id={'condition-'+key} aria-label={labels[key]} type="range" min="0" max={key==='a'?100:10} step={key==='a'?1:.1} value={key==='a'?p[key]*100:p[key]} onChange={e=>update(key,String(Number(e.target.value)/(key==='a'?100:1)))}/></label>)}</div>
    {scientific&&<p className="pedagogy-note">Pluie et salinité : indices pédagogiques de 0 à 10. La couleur de l’eau et les saisons sont illustratives, sans validation climatique ou écologique du lac de Guiers.</p>}</fieldset>
    <h3>Ma pratique de pêche</h3>
    {needsHabit&&<label className="practice-habit-confirmation"><input type="checkbox" checked={confirmHabit} disabled={busy} onChange={e=>setConfirmHabit(e.target.checked)}/> Je confirme la pratique ci-dessous comme ma pratique habituelle de départ.<small>Elle servira de repère fixe pour les réglages rapides, même après une décision ou un retour dans le temps.</small></label>}
    {!practiceAt(history,experiment,time)&&<p role="status">La pratique correspondant à l’effort courant n’est pas enregistrée. Les valeurs proposées par défaut incluent 4 sorties par semaine ; elles restent modifiables. Vous pouvez aussi importer le fichier de pratiques associé.</p>}
    <fieldset disabled={busy}><legend>Mes pirogues et mes sorties</legend><div className="practice-controls">
      {numberField('boats','Nombre de pirogues',1,true)}
      {selectField('motor','Type de pirogue',[['no','Non motorisée'],['yes','Motorisée']])}
      {numberField('tripsPerWeek','Sorties par semaine',0)}
      {selectField('tripScope','Ces sorties concernent',[['total','Toutes les pirogues ensemble'],['perBoat','Chaque pirogue']])}
      {numberField('tripHours','Durée d’une sortie (h)',0)}
      {practice.gearType==='gillnet'&&numberField('effectiveGearHours','Durée d’immersion (h par sortie)',0)}
      {practice.gearType==='longline'&&numberField('lineEffectiveHours','Durée effective d’utilisation des lignes (h par sortie)',0)}
    </div><p>La sortie comprend les déplacements. Un filet peut rester immergé après le retour de la pirogue.</p></fieldset>
    <fieldset disabled={busy}><legend>Mes engins</legend><div className="practice-controls">
      {selectField('gearType','Engin principal',[['gillnet','Filet maillant'],['longline','Ligne'],['seine','Senne'],['other','Autre engin']])}
      {numberField('gearCountPerTrip','Nombre d’engins par sortie',1,true)}
      {practice.gearType==='gillnet'&&<>{numberField('netLengthM','Longueur de chaque filet (m)',0)}{numberField('meshValue','Taille des mailles',0)}{selectField('meshUnit','Unité des mailles',[['mm','mm'],['cm','cm']])}</>}
      {practice.gearType==='longline'&&numberField('hooksPerLine','Hameçons par ligne',1,true)}
      {practice.gearType==='seine'&&numberField('haulsPerTrip','Opérations par senne et par sortie',1,true)}
      {practice.gearType==='other'&&<label>Nom local de l’engin<input aria-label="Nom local de l’engin" maxLength={80} required value={practice.otherGearName??''} onChange={e=>setPractice(prev=>({...prev,otherGearName:e.target.value}))}/></label>}
    </div><p>Le nombre d’engins concerne une sortie : une pirogue si les sorties sont déclarées par pirogue, le groupe sinon. La motorisation est appliquée une seule fois, à activité déclarée identique.</p></fieldset>
    <div className="practice-result" aria-live="polite" aria-atomic="true">
      {nominal&&<p><strong>{fmt(nominal.tripsPerMonth)} sorties/mois · {fmt(nominal.tripHoursPerMonth)} h de sortie/mois</strong><br/>Activité nominale ({practice.gearType==='gillnet'?'filet maillant':practice.gearType==='longline'?'ligne':'senne'}) : {fmt(nominal.nominalEffort)} {nominal.nominalUnit}</p>}
      <p>Puissance relative : engin × motorisation{practice.gearType==='gillnet'?' × mailles':''} — hypothèses de scénario non calibrées localement.</p>
      {scientific&&computed.effort&&<p>Facteurs : {fmt(computed.effort.gearFactor)} × {fmt(computed.effort.motorFactor)}{practice.gearType==='gillnet'?' × '+fmt(computed.effort.meshFactor):''}</p>}
      <span>Effort transmis au modèle : E</span>
      <output aria-label="Effort calculé pour le modèle"><strong>{computed.effort?fmt(computed.effort.modelEffort):'Non calculable'}</strong> unités d’effort du modèle (effort)</output>
      {computed.effort&&<p>× {fmt(computed.effort.relativeEffort)} par rapport à la pratique de référence ({fmt(computed.effort.referenceModelEffort)} unités d’effort).</p>}
    </div>
    <details className="practice-details"><summary>Détails du calcul et fichier de pratiques</summary>
      <p>Référence fixe du scénario : {history.reference.practice.boats} pirogue(s), {fmt(history.reference.practice.tripsPerWeek)} sorties/semaine ({history.reference.practice.tripScope==='total'?'pour le groupe':'par pirogue'}), {history.reference.practice.tripHours} h/sortie ; {history.reference.practice.gearCountPerTrip} engins ; longueur de filet {history.reference.practice.netLengthM??'—'} m ; utilisation {history.reference.practice.effectiveGearHours} h/sortie.</p>
      <p>{history.records.length?'Référence conservée depuis le début de cette déclaration.':'En l’absence de pratique enregistrée, cette convention explicite initialise la référence ; elle ne décrit pas une mesure de terrain.'} E réf. = {fmt(history.reference.modelEffort)} (valeur initiale du scénario) ; G réf. = {referenceNominal?fmt(referenceNominal.nominalEffort)+' '+referenceNominal.nominalUnit:'invalide'}.</p>
      <p>Sorties/mois = sorties/semaine × (pirogues uniquement si « Chaque pirogue ») × 52/12. Filets : G = sorties/mois × nombre de filets × longueur × immersion. Lignes : X = sorties × lignes × hameçons/ligne × durée effective. Sennes : X = sorties × sennes × opérations par senne par sortie. E = E réf. × (X/X réf. de l’engin) × α engin × μ motorisation × σ mailles. Les unités nominales ne sont jamais additionnées.</p>
      <p>Configuration : {history.configuration.id}, version {history.configuration.version} ; {history.configuration.source}. Statut : {history.configuration.status}. {history.configuration.warning}</p>
      <table><caption>Références et puissances configurées par engin</caption><thead><tr><th>Engin</th><th>X réf.</th><th>α</th><th>μ non motorisée</th><th>μ motorisée</th></tr></thead><tbody>{(['gillnet','line','seine'] as const).map(g=><tr key={g}><td>{g==='gillnet'?'Filet maillant':g==='line'?'Ligne':'Senne'}</td><td>{fmt(history.configuration.gearReferences[g].nominal)} {history.configuration.gearReferences[g].unit}</td><td>{fmt(history.configuration.gearReferences[g].relativePower)}</td><td>{fmt(history.configuration.motorRelativePower[g].no)}</td><td>{fmt(history.configuration.motorRelativePower[g].yes)}</td></tr>)}</tbody></table>
      <p>Table des mailles (mm → σ) : {history.configuration.gillnetMeshRelativePower.points.map(p=>`${fmt(p.meshMm)} → ${fmt(p.relativePower)}`).join(' ; ')}.</p>
      <p>Le modèle représente une biomasse agrégée, sans classes de tailles : le facteur de mailles ne décrit pas la mortalité des juvéniles et adultes.</p>
      {computed.effort&&<p>Décomposition : {fmt(computed.effort.referenceModelEffort)} × ({fmt(computed.effort.nominalEffort)} / {fmt(computed.effort.referenceNominal)} {computed.effort.nominalUnit}) × α={fmt(computed.effort.gearFactor)} × μ={fmt(computed.effort.motorFactor)} × σ={fmt(computed.effort.meshFactor)} = {fmt(computed.effort.modelEffort)}. {computed.effort.meshMm!==undefined&&`Maille convertie : ${fmt(computed.effort.meshMm)} mm.`}</p>}
      <p>Mailles : interpolation linéaire entre les points déclarés uniquement, sans extrapolation. Les autres engins utilisent σ = 1.</p>
      {history.records.some(r=>r.configuration.version===1)&&<p role="status">Annexe V1 migrée : les anciennes interventions conservent leurs facteurs neutres. Une nouvelle application utilise la configuration V2 affichée.</p>}
      <label>Charger une configuration de facteurs<input aria-label="Charger une configuration de facteurs" type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const input=e.currentTarget,file=input.files?.[0];if(!file)return;try{const configuration=importEffortConfiguration(await file.text());setHistory(prev=>({...prev,configuration}));setFileError('');}catch(error){setFileError((error as Error).message);}input.value='';}}/></label>
      <p>Une configuration chargée reste en cours d’édition jusqu’à l’application réussie ; Annuler l’abandonne. Chaque intervention conserve sa propre configuration dans l’annexe.</p>
      <p>L’allocation technique 50/30/20 reste interne au modèle et au rendu du lac ; elle ne décrit pas le nombre de pirogues déclaré ici.</p>
      <p>L’export habituel conserve le modèle et l’historique numérique. Conserver aussi ce fichier annexe pour retrouver les pratiques et leur référence après import. Les saisies en cours ne sont pas exportées.</p>
      <button type="button" disabled={busy} onClick={()=>downloadFile(exportPracticeHistory(request,history),request.model.id+'-pratiques.json')}>Exporter les pratiques appliquées</button>
      <label>Importer les pratiques associées<input aria-label="Importer les pratiques associées" type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const input=e.currentTarget,file=input.files?.[0];if(!file)return;try{const imported=importPracticeHistory(await file.text(),request);setHistory(imported);setPractice(practiceAt(imported,experiment,time)??{...initialReferencePractice});setFileError('');}catch(error){setFileError((error as Error).message);}input.value='';}}/></label>
    </details>
    {scientific&&<fieldset disabled={busy}><legend>Réponses environnementales — hypothèses non calibrées</legend><p>r(t) = r₀ f saison(t) exp(−ks(S−Sopt)²) ; q(t) = q₀ exp(βp P/10).</p><div className="scientific-conditions">{conditionKeys.filter(k=>!['P','S','a','E'].includes(k)).map(key=><label key={key}>{labels[key]}<input aria-label={labels[key]} type="number" step="any" min={key==='betaP'?-10:0} max={key==='q0'?1:10} value={Number.isFinite(p[key])?p[key]:''} onChange={e=>update(key,e.target.value)}/><small>{conditionUnits[key]}</small></label>)}</div></fieldset>}
    {(computed.error||fileError)&&<p className="error-banner" role="alert">{fileError||computed.error}</p>}
    <button className="primary" type="submit" disabled={busy||!!computed.error||!!fileError}>{busy?'Recalcul dans Irritator…':'Appliquer à partir du mois '+Number(time.toFixed(8))}</button>
    {scientific&&<p>Les décisions futures restent programmées. Une nouvelle valeur au même instant remplace la précédente pour ce paramètre ; les anciennes valeurs de l’historique sont mises à jour.</p>}
  </form>;
}
