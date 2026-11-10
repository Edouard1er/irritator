import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('8C E importe deux campagnes chevauchantes et relit la même identité séparément', async ({ page }) => {
  page.on('dialog', d => d.accept()); await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  const request = JSON.parse(await readFile(path.resolve('../../examples/decision-8c-normalization-v3.json'), 'utf8'));
  request.model.id = 'overlapping-normalization';
  const components = request.model.components, connections = request.model.connections;
  const edge = (from: string, fp: number, to: string, tp: number) => ({ from: { component: from, port: fp }, to: { component: to, port: tp } });
  // Two populations share candidate IDs and the coupled definition, with the
  // first campaign's data arriving after the second campaign has completed.
  for (const input of connections.filter((e: any) => e.to.component === 'normalize')) {
    const tag = components.find((c: any) => c.id === input.from.component);
    const wire = connections.find((e: any) => e.to.component === tag.id && e.to.port === 0);
    const source = components.find((c: any) => c.id === wire.from.component);
    if (input.to.port === 0) source.parameters.offset = .6;
    const nextSource = structuredClone(source), nextTag = structuredClone(tag);
    nextSource.id = 'second' + source.id; nextTag.id = 'second' + tag.id; nextTag.parameters.campaign = 2;
    nextSource.parameters.offset = input.to.port === 0 ? .2 : .05;
    if (input.to.port === 0) nextSource.parameters.value += 10;
    components.push(nextSource, nextTag); connections.push(edge(nextSource.id, 0, nextTag.id, 0), edge(nextTag.id, 0, 'normalize', input.to.port));
  }
  const reads = connections.filter((e: any) => e.to.component === 'scores' && e.to.port === 1);
  request.model.connections = connections.filter((e: any) => !reads.includes(e) || e === reads[0]);
  components.push({ id: 'secondRead', type: 'constant', parameters: { value: 0, offset: 2 } }, { id: 'secondReadTag', type: 'event_tag', parameters: { identity: 0, campaign: 2 } });
  request.model.connections.push(edge('secondRead', 0, 'secondReadTag', 0), edge('secondReadTag', 0, 'scores', 1));
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles({ name: 'overlap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(request)) });
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const res = await response, result = await res.json(); expect(res.ok(), JSON.stringify(result)).toBe(true);
  const { runId, ...actual } = result; expect(runId).toBeTruthy();
  expect(actual).toEqual(JSON.parse(execFileSync(path.resolve(process.env.IRRITATOR_RUNNER!), [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true })));
  const samples = result.observations.find((o: any) => o.component === 'ratioReceipt').samples;
  expect(samples.some((s: any) => Math.abs(s.value - .25) < 1e-12)).toBe(true); expect(samples.at(-1).value).toBe(.4);
  const evidence = path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '8c') : '../../../build-web-test8c/browser'); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'overlapping-campaigns.json'), JSON.stringify({ request, result, httpEqualsNative: true }, null, 2));
});
