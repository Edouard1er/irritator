import React from 'react';
import {act,render} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {BiomassLake} from '@/components/simulation/biomass-lake';
import source from '../../../examples/atelier-interventions-month-v3.json';

let dimensions={width:600,height:400};
let resize:()=>void;
let frames:Map<number,FrameRequestCallback>;
let nextFrame:number;
const ctx={setTransform:vi.fn(),clearRect:vi.fn(),save:vi.fn(),translate:vi.fn<(x:number,y:number)=>void>(),scale:vi.fn(),beginPath:vi.fn(),ellipse:vi.fn<(x:number,y:number,rx:number,ry:number,rotation:number,start:number,end:number)=>void>(),fill:vi.fn(),fillRect:vi.fn(),stroke:vi.fn(),moveTo:vi.fn<(x:number,y:number)=>void>(),lineTo:vi.fn<(x:number,y:number)=>void>(),closePath:vi.fn(),arc:vi.fn(),restore:vi.fn()};
const props={value:150,unit:'t',maximum:300,playing:false,reduced:false,state:'favorable' as const,season:2,environment:{...source.temporal.parameters,P:0,S:3,E:150,a:1},fleet:{counts:[3,2,2] as [number,number,number],utilization:[1,1,1] as [number,number,number]}};
beforeEach(()=>{
  dimensions={width:600,height:400};frames=new Map();nextFrame=0;
  vi.stubGlobal('ResizeObserver',class {constructor(callback:()=>void){resize=callback;}observe(){}disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++nextFrame,callback);return nextFrame;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype,'getBoundingClientRect').mockImplementation(()=>({...dimensions} as DOMRect));
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  Object.values(ctx).forEach(mock=>{if(vi.isMockFunction(mock))mock.mockClear();});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();Reflect.deleteProperty(document,'fullscreenElement');});
function positions(){return ctx.translate.mock.calls.slice(-15).map(([x,y])=>[x/dimensions.width,y/dimensions.height]);}
function tick(now:number){act(()=>{const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(now));});}
function resized(width:number,height:number){dimensions={width,height};act(()=>resize());}

describe('The existing lake canvas resizes without resetting the scene',()=>{
  it('keeps fish identity, relative positions and shape through repeated changes of aspect ratio',()=>{
    const view=render(<BiomassLake {...props}/>),canvas=view.container.querySelector('canvas')!;
    const before=positions();
    for(const [width,height] of [[1920,1080],[2560,1080],[1100,900],[600,400]]){
      resized(width!,height!);
      expect(view.container.querySelector('canvas')).toBe(canvas);
      const after=positions();
      after.forEach(([x,y],i)=>{expect(x).toBeCloseTo(before[i]![0]!,12);expect(y).toBeCloseTo(before[i]![1]!,12);});
      const ellipses=ctx.ellipse.mock.calls.slice(-15);
      expect(ellipses).toHaveLength(15);
      for(const [,,rx,ry] of ellipses)expect(rx/ry).toBeCloseTo(.38/.21,12);
      expect(canvas).toHaveAttribute('data-biomass','150');expect(canvas).toHaveAttribute('data-boats','3,2,2');
      expect(frames.size).toBe(0);
    }
  });
  it('repaints the current motion phase on resize without advancing it or multiplying animation loops',()=>{
    const view=render(<BiomassLake {...props} playing/>);
    tick(100);tick(140);tick(180);
    const moving=positions();
    expect(frames.size).toBe(1);
    resized(1920,1080);
    positions().forEach(([x,y],i)=>{expect(x).toBeCloseTo(moving[i]![0]!,12);expect(y).toBeCloseTo(moving[i]![1]!,12);});
    expect(frames.size).toBe(1);
    tick(220);expect(positions()).not.toEqual(moving);
    view.rerender(<BiomassLake {...props}/>);
    const paused=positions();expect(frames.size).toBe(0);
    resized(600,400);
    positions().forEach(([x,y],i)=>{expect(x).toBeCloseTo(paused[i]![0]!,12);expect(y).toBeCloseTo(paused[i]![1]!,12);});
    view.rerender(<BiomassLake {...props} playing/>);
    positions().forEach(([x,y],i)=>{expect(x).toBeCloseTo(paused[i]![0]!,12);expect(y).toBeCloseTo(paused[i]![1]!,12);});
    tick(260);tick(300);expect(positions()).not.toEqual(paused);expect(frames.size).toBe(1);
    view.unmount();expect(frames.size).toBe(0);
  });
  it('recovers a hidden playing canvas when it becomes visible',()=>{
    dimensions={width:0,height:0};render(<BiomassLake {...props} playing/>);
    expect(ctx.ellipse).not.toHaveBeenCalled();expect(frames.size).toBe(1);
    resized(600,400);expect(ctx.ellipse).toHaveBeenCalledTimes(15);expect(frames.size).toBe(1);
    tick(100);tick(140);expect(ctx.ellipse).toHaveBeenCalledTimes(45);expect(frames.size).toBe(1);
  });
  it('keeps the full sun below the fullscreen controls and above the water on short desktop screens',()=>{
    const view=render(<article className="lake-card"><BiomassLake {...props} season={1}/></article>);
    Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>view.container.querySelector('.lake-card')});
    for(const [width,height] of [[1366,768],[1920,1080],[2560,1080]]){
      ctx.moveTo.mockClear();ctx.lineTo.mockClear();resized(width!,height!);
      for(const [x,y] of [...ctx.moveTo.mock.calls.slice(0,12),...ctx.lineTo.mock.calls.slice(0,12)]){
        expect(x).toBeGreaterThan(0);expect(x).toBeLessThan(width!);
        expect(y).toBeGreaterThan(52);expect(y).toBeLessThan(height!*.27);
      }
    }
  });
});
