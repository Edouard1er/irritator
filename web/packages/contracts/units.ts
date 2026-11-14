import type { Component, RunRequest, RunResult } from './index.js';
import type { RunResultV2 } from './wrapper-v3.js';
import { compileTemporal } from './temporal.js';

export type TimeUnit = 'month' | 'year';
export type Unit = 't' | 'kg' | 'month' | 'year' | 't/month' | 't/year' | 'kg/month' | 'kg/year' | '1/month' | '1/year' | '1/t' | '1/kg' | 'ratio' | 'effort' | '1/(effort*month)' | '1/(effort*year)';
export interface ModelUnits {
  time: TimeUnit;
  biomass?: 't' | 'kg'; cumulativeCatch?: 't' | 'kg'; catchRate?: Unit;
  growthRate?: Unit; accessibility?: 'ratio'; effort?: 'effort'; catchability?: Unit;
  provenance: { basis: 'declared' | 'workshop-convention' | 'converted'; note: string; sourceTime?: TimeUnit };
}
export interface ComponentUnits { output?: Unit; parameters?: Record<string, Unit> }
export type UnitScope = { units?: ModelUnits; components: Component[] };
export const unitLabel = (unit?: string): string => ({ month: 'mois', year: 'an', '1/month': 'mois⁻¹', '1/year': 'an⁻¹', 't/month': 't/mois', 'kg/month': 'kg/mois', 't/year': 't/an', 'kg/year': 'kg/an', ratio: 'sans dimension', effort: 'unité d’effort', '1/(effort*month)': '(unité d’effort · mois)⁻¹', '1/(effort*year)': '(unité d’effort · an)⁻¹' }[unit ?? ''] ?? unit ?? 'unité du modèle');

/** Metadata only. Same-clock coupled instances cannot change the DEVS time scale. */
export function validateUnits(request: RunRequest): void {
  const fail = (message: string): never => { throw new Error(`Unités : ${message}`); };
  const definitions = request.model.definitions ?? [];
  const validate = (scope: UnitScope, path: string) => {
    const u = scope.units;
    if (u?.provenance.basis === 'converted' && !u.provenance.sourceTime) fail(`${path} : source temporelle requise pour une conversion`);
    for (const c of scope.components) {
      for (const key of Object.keys(c.units?.parameters ?? {})) if (!(key in c.parameters)) fail(`${path}/${c.id} : paramètre ${key} inexistant`);
      if (c.units?.parameters?.offset && u && c.units.parameters.offset !== u.time) fail(`${path}/${c.id} : offset incompatible avec le temps du modèle`);
      if (c.type === 'coupled') {
        const child = definitions.find(d => d.id === c.definition);
        if (u && child?.units && u.time !== child.units.time) fail(`${path}/${c.id} : temps couplés différents (${u.time}/${child.units.time}) ; convertir explicitement le modèle avant exécution`);
      }
    }
    if (!u) return;
    if (u.growthRate && u.growthRate !== `1/${u.time}`) fail(`${path} : croissance incompatible avec ${u.time}`);
    if (u.catchability && u.catchability !== `1/(effort*${u.time})`) fail(`${path} : capturabilité incompatible avec ${u.time}`);
    if (!u.biomass) return;
    const mass = u.biomass, rate = `${mass}/${u.time}`, inverse = `1/${u.time}`, q = `1/(effort*${u.time})`;
    if (u.cumulativeCatch && u.cumulativeCatch !== mass) fail(`${path} : biomasse et cumul doivent partager la même unité de masse`);
    for (const [actual, expected] of [[u.catchRate, rate], [u.growthRate, inverse], [u.catchability, q]]) if (actual && actual !== expected) fail(`${path} : dimension ${actual} incompatible avec ${expected}`);
    // Check declared parameter/output dimensions of the shipped Schaefer vocabulary.
    const expected: Record<string, string> = { N: mass, C: mass, qaEN: rate, r: inverse, q, a: 'ratio', E: 'effort', InvK: `1/${mass}` };
    for (const c of scope.components) {
      const e = expected[c.id]; if (!e) continue;
      if (c.units?.output && c.units.output !== e) fail(`${path}/${c.id} : sortie ${c.units.output}, attendu ${e}`);
      const key = ['N', 'C'].includes(c.id) ? 'X' : 'value';
      if (c.units?.parameters?.[key] && c.units.parameters[key] !== e) fail(`${path}/${c.id}.${key} : attendu ${e}`);
      if (['N', 'C'].includes(c.id) && c.units?.parameters?.dQ && c.units.parameters.dQ !== mass) fail(`${path}/${c.id}.dQ : attendu ${mass}`);
      if (c.id === 'a' && (c.parameters.value! < 0 || c.parameters.value! > 1)) fail(`${path}/a : fraction attendue entre 0 et 1`);
    }
  };
  validate(request.model, '$root'); for (const d of definitions) validate(d, d.id);
  // Check effective clocks through unannotated intermediate coupled definitions.
  // Memoization also bounds traversal of shared definitions and malformed cycles.
  const visited = new Set<string>();
  const clocks = (scope: UnitScope, path: string, inherited?: ModelUnits) => {
    const units = scope.units ?? inherited, key = `${path}:${units?.time ?? '?'}`;
    if (visited.has(key)) return; visited.add(key);
    for (const c of scope.components) {
      if (units && c.units?.parameters?.offset && c.units.parameters.offset !== units.time) fail(`${path}/${c.id} : offset incompatible avec le temps hérité`);
      if (c.type !== 'coupled') continue;
      const child = definitions.find(d => d.id === c.definition); if (!child) continue;
      if (units && child.units && units.time !== child.units.time) fail(`${path}/${c.id} : temps couplés différents après héritage`);
      clocks(child, child.id, units);
    }
  };
  clocks(request.model, '$root'); for (const d of definitions) clocks(d, d.id);
}

export function scopeForPath(request: RunRequest, path: string, initial: UnitScope = request.model): { scope: UnitScope; component?: Component } {
  let scope = initial; let component: Component | undefined;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    component = scope.components.find(c => c.id === parts[i]);
    if (i < parts.length - 1) {
      const d = request.model.definitions?.find(d => d.id === component?.definition);
      if (!d) return { scope };
      scope = !d.units && scope.units ? { ...d, units: { time: scope.units.time, provenance: scope.units.provenance } } : d;
    }
  }
  return { scope, ...(component ? { component } : {}) };
}

/** Compile optional timed signals, then strip unit metadata for the historical native protocol. */
export function nativeRequest(request: RunRequest): RunRequest {
  const copy = compileTemporal(request);
  const strip = (scope: UnitScope) => { delete scope.units; scope.components.forEach(c => { delete c.units; }); };
  strip(copy.model); copy.model.definitions?.forEach(strip); return copy;
}

/** Attach validated declarations to native samples, without changing any number. */
export function attachResultUnits<T extends RunResult | RunResultV2>(result: T, request: RunRequest): T {
  const annotate = (observations: RunResult['observations'], initial: UnitScope) => observations.map(o => {
    const { component, scope } = scopeForPath(request, o.component, initial);
    const { unit: _unit, timeUnit: _time, ...native } = o;
    return { ...native, ...(component?.units?.output ? { unit: component.units.output } : {}), ...(scope.units ? { timeUnit: scope.units.time } : {}) };
  });
  const copy = { ...result, ...(request.model.units ? { units: structuredClone(request.model.units) } : {}), observations: annotate(result.observations, request.model) };
  if (!request.model.units) delete copy.units;
  if (copy.schemaVersion === 2 && copy.scenarioTrajectories) copy.scenarioTrajectories = copy.scenarioTrajectories.map(row => {
    const wrapper = scopeForPath(request, row.wrapperId).component;
    const scope = request.model.definitions?.find(d => d.id === wrapper?.experiment?.definition);
    const { units: _units, ...native } = row;
    return { ...native, ...(scope?.units ? { units: structuredClone(scope.units) } : {}), observations: scope ? annotate(row.observations, scope) : row.observations };
  });
  return copy;
}

/** Explicit duration/rate conversion; no absolute calendar origin is inferred. */
export const convertDuration = (value: number, from: TimeUnit, to: TimeUnit): number => value * (from === to ? 1 : from === 'year' ? 12 : 1 / 12);
export const convertRate = (value: number, from: TimeUnit, to: TimeUnit): number => value / convertDuration(1, from, to);
