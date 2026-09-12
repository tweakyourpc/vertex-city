/** The v3 controls: geography, visual style, and data layers stay independent. */
export const presentation = { appearance: 'readable', lighting: 'day' };
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
