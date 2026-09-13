import { WIRE_PALETTES, DEFAULT_WIRE_PALETTE } from './render/palettes.js';
import { setWorkerOverride, currentWorkerOverride } from './runtime-config.js';

/** The v3 controls: geography, visual style, and data layers stay independent. */
export const presentation = {
  appearance: 'readable', lighting: 'day', wirePalette: DEFAULT_WIRE_PALETTE,
};
const $ = id => document.getElementById(id);
let noticeTimer;
export function notify(message) {
  $('notice').textContent = message;
  $('notice').classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('notice').classList.remove('visible'),6000);
}
export function bindExperience({ input, cam, state, screen, layers, signs, labels, traffic }) {
  const clearInput = () => {
    input.keys = Object.create(null); input.taps = Object.create(null);
    input.dx = input.dy = 0; input.dragging = false;
  };
  let openPanel = null;
  const close = () => {
    $('hud').hidden = true; openPanel = null;
    for (const name of ['city','layers','view']) $('open-'+name).setAttribute('aria-expanded','false');
    clearInput(); $('c').focus({preventScroll:true});
  };
  for (const name of ['city','layers','view']) $('open-'+name).addEventListener('click', () => {
    if (openPanel === name) { close(); return; }
    clearInput(); openPanel = name; $('hud').hidden = false;
    $('panel-title').textContent = {city:'Find your next street.',layers:'Another layer of the city.',view:'Make the view your own.'}[name];
    for (const section of document.querySelectorAll('[data-panel]')) section.hidden = section.dataset.panel !== name;
    for (const key of ['city','layers','view']) $('open-'+key).setAttribute('aria-expanded',String(key===name));
    if (name==='city') $('coords').focus();
  });
  $('close-panel').onclick = close;
  const guide = on => { $('guide').hidden = !on; $('help-toggle').setAttribute('aria-expanded',String(on)); clearInput(); if(on)$('close-guide').focus(); };
  $('help-toggle').onclick = () => guide($('guide').hidden);
  $('close-guide').onclick = () => { guide(false); $('help-toggle').focus(); };
  window.addEventListener('keydown',event => { if(event.key==='Escape'){close();guide(false);} });
  $('appearance').onchange = () => setAppearance($('appearance').value,screen);
  $('lighting').onchange = () => {presentation.lighting=$('lighting').value;};
  // Built from the palette table rather than written out in the markup, so a
  // new scheme is one entry in palettes.js and appears here on its own.
  $('wire-palette').append(...Object.entries(WIRE_PALETTES).map(([value,scheme]) => {
    const option=document.createElement('option');
    option.value=value; option.textContent=scheme.label;
    return option;
  }));
  $('wire-palette').value=presentation.wirePalette;
  $('wire-palette').onchange = () => {
    presentation.wirePalette=$('wire-palette').value;
    // Choosing a scheme is how someone asks to see it.
    if(presentation.appearance!=='wireframe') setAppearance('wireframe',screen);
  };
  for(const control of document.querySelectorAll('[data-layer]')) {
    control.onchange = () => {
      const layer=layers[control.dataset.layer];
      if(layer.enabled!==control.checked) layer.toggle();
    };
  }
  $('show-signs').checked = signs.on;
  $('show-signs').onchange = () => { signs.on = $('show-signs').checked; };
  $('show-labels').checked = labels.mode===2;
  $('show-labels').onchange = () => { labels.mode = $('show-labels').checked?2:0; };
  $('traffic-mode').value=String(traffic.mode);
  $('traffic-mode').onchange = () => { while(traffic.mode!==Number($('traffic-mode').value))traffic.cycle(); };
  // The Worker for live aircraft and cameras, set from inside the application.
  // It used to require editing a source file or hand-writing a query parameter,
  // which is not configuration anyone should be expected to discover.
  const workerState=(msg,cls)=>{ const el=$('worker-state');
    if(!el) return; el.textContent=msg; el.className='provider-status'+(cls?' '+cls:''); };
  const applyWorker=(value)=>{
    const chosen=setWorkerOverride(value);
    // Live, not on next reload: both layers read this on every poll.
    layers.aircraft.workerUrl=chosen;
    layers.flock.workerUrl=chosen;
    if(chosen){
      workerState('Using '+chosen,'ok');
      // A layer already switched on should start working immediately.
      layers.aircraft.refreshNow?.();
    } else if(String(value||'').trim()){
      workerState('That is not a usable http(s) URL','bad');
    } else {
      workerState('Cleared. Aircraft and cameras are off until one is set.');
    }
  };
  if($('worker-url')){
    $('worker-url').value=currentWorkerOverride();
    if(currentWorkerOverride()) workerState('Using '+currentWorkerOverride(),'ok');
    $('worker-save').onclick=()=>applyWorker($('worker-url').value);
    $('worker-url').addEventListener('keydown',(e)=>{
      if(e.key==='Enter'){ applyWorker($('worker-url').value); }
      e.stopPropagation();
    });
  }

  $('flight-toggle').onclick = () => { input.taps.v=(input.taps.v||0)+1; };
  for(const button of document.querySelectorAll('[data-move]')) {
    button.onpointerdown = event => { event.preventDefault();button.setPointerCapture(event.pointerId);input.keys[button.dataset.move]=true; };
    for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>{input.keys[button.dataset.move]=false;});
  }
  return () => {
    const world=state.world;
    if(!world)return;
    $('place-title').textContent=world.label;
    const synthetic=!world.bbox||world.synthetic;
    $('source-badge').textContent=synthetic?'FICTIONAL CITY':'OPENSTREETMAP GEOGRAPHY';
    $('scene-provenance').textContent=synthetic?'Procedural geography · simulated street life':'Mapped streets & footprints · interpreted details';
    $('lighting-badge').textContent={day:'DAYLIGHT STUDY',golden:'GOLDEN HOUR STUDY',night:'NIGHT STUDY',live:'REAL SOLAR LIGHT'}[presentation.lighting];
    const bearing=((90-cam.angle*180/Math.PI)%360+360)%360;
    const compass=['N','NE','E','SE','S','SW','W','NW'];
    $('heading').textContent=compass[Math.round(bearing/45)%8]+' '+Math.round(bearing)+'°';
    $('flight-toggle').textContent=cam.movement==='fly'?'↓ Walk':'↑ Fly';
    $('render-status').textContent={readable:'CITYSCAPE',wireframe:'WIREFRAME',ascii:'ASCII',cinematic:'PIXEL'}[presentation.appearance];
    $('appearance').value=presentation.appearance;
    $('wire-palette').value=presentation.wirePalette;
    let count=0;
    for(const control of document.querySelectorAll('[data-layer]')) { control.checked=layers[control.dataset.layer].enabled;if(control.checked)count++; }
    $('layer-count').textContent=count;
    $('show-signs').checked=signs.on;$('show-labels').checked=labels.mode===2;
    $('traffic-mode').value=String(traffic.mode);
  };
}
/** Views drawn by the WebGL surface renderer rather than the character grid. */
export const GEOMETRY_VIEWS = new Set(['readable','wireframe']);

export function setAppearance(value, screen) {
  presentation.appearance=value;
  screen.setMode(value==='ascii'?0:2);
  $('geometry').hidden=!GEOMETRY_VIEWS.has(value);
}
