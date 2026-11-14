import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MonthlyCatchChart} from '@/components/simulation/monthly-catch-chart';
import {BiomassLake} from '@/components/simulation/biomass-lake';
import {fishCount} from '@/lib/simulation/indicators';
import {seasonAt} from '@contracts';
import type {Series} from '@/lib/simulation/trajectory';

beforeEach(()=>{vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('Fisher reading 3.1',()=>{
  it.each([[50,5],[100,10],[150,15],[158.6,16],[200,20],[300,30]])('displays %s native tonnes as %s fish, preserving numeric biomass', (value,count)=>{
    const {container}=render(<BiomassLake value={value} unit="t" maximum={300} playing={false} reduced={false} state="favorable"/>);
    expect(fishCount(value,'t')).toBe(count);expect(container.querySelector('canvas')).toHaveAttribute('data-fish-count',String(count));expect(container.querySelector('canvas')).toHaveAttribute('data-biomass',String(value));
    expect(container.querySelector('.lake-count')).toHaveTextContent(new Intl.NumberFormat('fr-FR').format(value));expect(container.textContent).not.toMatch(/symbole|pictogramme|arrondi/i);
  });
  it('updates the fish count and exact biomass in both directions',()=>{
    const props={unit:'t',maximum:300,playing:false,reduced:true,state:'favorable' as const};
    const view=render(<BiomassLake {...props} value={100}/>);
    for(const [value,count] of [[158.6,16],[300,30],[50,5]]){view.rerender(<BiomassLake {...props} value={value}/>);expect(view.container.querySelector('canvas')).toHaveAttribute('data-fish-count',String(count));expect(view.container.querySelector('canvas')).toHaveAttribute('data-biomass',String(value));}
  });
  it('shows only completed discrete monthly values, joined without smoothing, with the common cursor',()=>{
    const series={id:'C',kind:'catch_cumulative',unit:'t',points:[{time:0,value:0},{time:1,value:12.5},{time:2,value:30},{time:3,value:33}]} as Series;
    const select=vi.fn(),view=render(<MonthlyCatchChart series={series} time={1.5} end={3} onSelect={select}/>);
    expect(view.container.querySelectorAll('[data-monthly-point]')).toHaveLength(1);expect(view.container.querySelector('[data-month="1"]')).toHaveAttribute('data-catch','12.5');expect(view.container.querySelector('[data-month="2"]')).toHaveAttribute('data-catch','17.5');expect(view.container.querySelector('rect')).toBeNull();
    expect(view.container.querySelector('[data-monthly-line]')?.getAttribute('d')).not.toMatch(/[CQ]/);const cursor=view.container.querySelector('[data-monthly-cursor]')?.getAttribute('x1');
    view.rerender(<MonthlyCatchChart series={series} time={2} end={3} onSelect={select}/>);expect(view.container.querySelectorAll('[data-monthly-point]')).toHaveLength(2);expect(view.container.querySelector('[data-current="true"]')).toHaveAccessibleName('Mois 2 : 17,5 tonnes');expect(view.container.querySelector('[data-monthly-cursor]')?.getAttribute('x1')).not.toBe(cursor);
    const point=screen.getByRole('button',{name:'Mois 2 : 17,5 tonnes'});fireEvent.focus(point);expect(screen.getByRole('tooltip')).toHaveTextContent('Mois 2 · 17,5 tonnes');fireEvent.keyDown(point,{key:'Enter'});expect(select).toHaveBeenCalledWith(2);
    expect(series.points.map(p=>p.value)).toEqual([0,12.5,30,33]);
  });
  it('leaves missing monthly boundaries unavailable instead of joining across a gap',()=>{
    const series={id:'C',kind:'catch_cumulative',unit:'t',points:[{time:0,value:0},{time:1,value:10},{time:3,value:30},{time:4,value:40}]} as Series;
    const view=render(<MonthlyCatchChart series={series} time={4} end={4}/>);
    expect(view.container.querySelectorAll('[data-monthly-point]')).toHaveLength(2);expect(view.container.querySelector('[data-monthly-line]')?.getAttribute('d')?.match(/M/g)).toHaveLength(2);expect(screen.getByLabelText('Mois 2 indisponible')).toBeInTheDocument();
  });
  it.each([[0,'Printemps'],[3,'Été'],[6,'Automne'],[9,'Hiver'],[12,'Printemps'],[15,'Été']])('uses simulated time %s for the visible season %s', (time,name)=>{
    const {index}=seasonAt(time);const view=render(<BiomassLake value={150} unit="t" maximum={300} playing={false} reduced state="favorable" season={index} environment={{P:8,S:3} as never}/>);
    expect(view.container.querySelector('canvas')).toHaveAttribute('data-season',name);expect(view.container.querySelector('.lake-season')).toHaveTextContent(name);expect(view.container.querySelector('canvas')).toHaveAttribute('data-rain','8');
  });
});
