// The original pearl-like folds translate continuously downward without rotating.
// No particles, network lines, textures, videos or per-frame React updates.
const backdropVertex = `attribute vec2 aPosition;varying vec2 vUv;
void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
const backdropFragment = `
precision highp float;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uPointer;
uniform float uInteraction;
varying vec2 vUv;
float softBand(float d,float width){float q=d/width;return exp(-q*q);}
void main(){
  float aspect=uSize.x/uSize.y;
  vec2 p=(vUv*2.-1.)*vec2(min(aspect,1.9),1.);
  vec2 pointer=uPointer*vec2(min(aspect,1.9),1.);
  vec2 delta=p-pointer;
  p+=delta*exp(-dot(delta,delta)*2.)*.035*uInteraction;
  vec3 paper=vec3(.9843,.9843,.9882);
  vec3 color=paper;
  // UV points upward: sampling higher over time moves the pattern downward.
  // Keep its shape/material fixed; only translate the sampling coordinates.
  float flowY=p.y+uTime*.16;
  float x=p.x*.78+flowY*.32;
  float y=flowY-p.x*.14;
  for(int i=0;i<5;i++){
    float id=float(i);
    float center=(id-2.)*.57+.34*sin(y*1.45+id*.65)
      +.14*sin(y*2.4+id*.4);
    float width=.17+.045*sin(id);
    // Repeat the folds across the infinite field so long playback never empties.
    float d=mod(x-center+1.425,2.85)-1.425;
    float body=softBand(d,width);
    float shadow=softBand(d-width*.7,width*.42);
    float highlight=softBand(d+width*.5,width*.26);
    vec3 silver=mix(vec3(.77,.815,.825),vec3(.81,.845,.815),.5+.5*sin(id*1.3));
    color=mix(color,silver,body*.55);
    color-=vec3(.055,.05,.045)*shadow;
    color=mix(color,vec3(1.),highlight*.55);
    float filament=pow(.5+.5*sin(d*165.+y*.6),10.)*body;
    color-=vec3(.016,.019,.018)*filament;
  }
  // A broad light wash softens contrast behind the download copy without
  // cutting an empty rectangular hole through the composition.
  float wash=softBand(p.x,aspect<.9?.8:.62)*.44;
  color=mix(color,paper,wash);
  float edge=clamp(length(vUv-.5),0.,.7);
  color=mix(color,paper,smoothstep(.4,.75,edge)*.24);
  gl_FragColor=vec4(clamp(color,0.,1.),1.);
}`;

function makeProgram(gl, vertex, fragment, isWebGL2) {
  const shaders = [];
  const program = gl.createProgram();
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      let code = source;
      if (isWebGL2) {
        code = '#version 300 es\n' + code.replace(/\battribute\b/g, 'in').replace(/\bvarying\b/g, type === gl.VERTEX_SHADER ? 'out' : 'in');
        if (type === gl.FRAGMENT_SHADER) code = code.replace('void main()', 'out vec4 outColor;\nvoid main()').replace(/gl_FragColor/g, 'outColor');
      }
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
}

export function mountGenerativeBackground(host) {
  if (!host) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 700px), (pointer: coarse)');
  const startup = host.dataset.renderMode === 'startup';
  const constrained = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || navigator.connection?.saveData;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.replaceChildren(canvas);
  let gl, fieldProgram, observer, frame = 0, disposed = false, failed = false;
  let last = 0, time = Math.random() * 700, quality = 1, slow = 0;
  let pointerX = -10, pointerY = -10, targetX = -10, targetY = -10, pointerAt = -10000;
  const buffers = [];
  const locations = new Map();
  let fullscreen, isWebGL2, dpr = 1, firstPaint = true;
  const low = () => constrained || mobile.matches;
  const fallback = () => {
    failed = true;
    cancelAnimationFrame(frame);
    host.dataset.renderer = 'fallback';
    canvas.hidden = true;
    release();
  };
  function release() {
    if (!gl) return;
    buffers.forEach(buffer => gl.deleteBuffer(buffer));
    buffers.length = 0;
    if (fieldProgram) gl.deleteProgram(fieldProgram);
    fieldProgram = null;
  }
  function uniform(program, name) {
    const key = name;
    if (!locations.has(key)) locations.set(key, gl.getUniformLocation(program, name));
    return locations.get(key);
  }
  function buffer(data) {
    const value = gl.createBuffer();
    buffers.push(value);
    gl.bindBuffer(gl.ARRAY_BUFFER, value);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return value;
  }
  function attribute(program, name, value, size, stride = 0, offset = 0) {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, value);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
  }
  function resize() {
    if (disposed || failed) return;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    // Keep the image sharp when reducing workload: lower the frame rate first.
    dpr = Math.min(devicePixelRatio || 1, startup ? 1.5 : constrained ? 1.5 : 2);
    const pixelBudget = startup ? 1200000 : constrained ? 2000000 : mobile.matches ? 2500000 : 8000000;
    dpr = Math.min(dpr, Math.sqrt(pixelBudget / (w * h)));
    const width = Math.max(1, Math.round(w * dpr)), height = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    // Resizing clears the WebGL buffer. Repaint in the same task, including
    // during mobile browser chrome changes when animation frames may pause.
    if (!document.hidden) draw();
  }
  function common(program) {
    gl.useProgram(program);
    gl.uniform2f(uniform(program, 'uSize'), host.clientWidth, host.clientHeight);
    gl.uniform1f(uniform(program, 'uTime'), time);
    gl.uniform2f(uniform(program, 'uPointer'), pointerX, pointerY);
    gl.uniform1f(uniform(program, 'uInteraction'), low() || reduced.matches ? 0 : Math.exp(-Math.max(0, performance.now() - pointerAt) / 1800));
  }
  function draw() {
    if (!gl || !fieldProgram || disposed || failed) return;
    try {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      common(fieldProgram);
      attribute(fieldProgram, 'aPosition', fullscreen, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (firstPaint) {
        firstPaint = false;
        requestAnimationFrame(() => { if (!disposed && !failed) host.classList.add('generative-ready'); });
      }
    } catch { fallback(); }
  }
  function tick(now) {
    frame = 0;
    if (disposed || failed || document.hidden || reduced.matches) return;
    const interval = 1000 / (low() || quality < .7 ? 30 : 60);
    const dt = now - last;
    if (dt >= interval - 1) {
      last = now;
      time += Math.min(dt, 100) / 1000;
      const follow = Math.min(1, dt / 220);
      pointerX += (targetX - pointerX) * follow;
      pointerY += (targetY - pointerY) * follow;
      draw();
      slow = dt > interval * 1.8 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 40 && quality > .55) { quality = Math.max(.55, quality - .15); slow = 0; resize(); }
    }
    if (!failed) frame = requestAnimationFrame(tick);
  }
  function resume() {
    cancelAnimationFrame(frame);
    host.classList.toggle('generative-paused', document.hidden || reduced.matches);
    if (disposed || failed || document.hidden) return;
    last = performance.now();
    draw();
    if (!reduced.matches) frame = requestAnimationFrame(tick);
  }
  const move = e => {
    if (low() || reduced.matches) return;
    targetX = e.clientX / innerWidth * 2 - 1;
    targetY = 1 - e.clientY / innerHeight * 2;
    pointerAt = performance.now();
  };
  const lost = e => { e.preventDefault(); fallback(); };
  try {
    // A discarded/cleared buffer must reveal the light fallback, never black.
    const options = { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
    gl = canvas.getContext('webgl2', options);
    isWebGL2 = Boolean(gl);
    if (!gl) gl = canvas.getContext('webgl', options);
    if (!gl) throw new Error('WebGL unavailable');
    fieldProgram = makeProgram(gl, backdropVertex, backdropFragment, isWebGL2);
    fullscreen = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    canvas.addEventListener('webglcontextlost', lost);
    host.dataset.renderer = isWebGL2 ? 'webgl2' : 'webgl';
    resize();
  } catch { fallback(); }
  observer = new ResizeObserver(resize);
  observer.observe(host);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', move, { passive: true });
  reduced.addEventListener('change', resume);
  mobile.addEventListener('change', resize);
  resume();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', move);
    reduced.removeEventListener('change', resume);
    mobile.removeEventListener('change', resize);
    canvas.removeEventListener('webglcontextlost', lost);
    release();
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    host.replaceChildren();
    host.classList.remove('generative-ready');
    delete host.dataset.renderer;
  };
}
