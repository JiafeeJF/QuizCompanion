// Shared by the React download route and the standalone download page.
// All field, packet, lifecycle and network positions are evaluated on the GPU.
const field = `
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float noise(float n) { float i = floor(n); float f = fract(n); return mix(hash(i), hash(i+1.0), f*f*(3.0-2.0*f)); }
float line(vec2 p, vec2 a, vec2 b) { vec2 d=b-a; return length(p-a-d*clamp(dot(p-a,d)/max(dot(d,d),0.0001),0.0,1.0)); }
vec3 scene(vec2 uv) {
  float t = u.a.z;
  float aspect = u.a.x/u.a.y;
  vec2 p=(uv-vec2(0.5))*vec2(aspect,1.0);
  vec2 center=vec2(aspect*mix(0.03,0.26,smoothstep(0.7,1.5,aspect)),0.02);
  vec2 q=p-center;
  vec2 mouse=(u.b.xy-vec2(0.5))*vec2(aspect,1.0);
  q += (p-mouse)*exp(-length(p-mouse)*12.0)*0.12*u.b.z;
  float r=length(q);
  float angle=atan(q.y,q.x);
  float glow=0.0;
  float mint=0.0;
  // Independently clocked routed lanes: ingress, aggregation and redistribution.
  for(int i=0;i<18;i++) {
    float id=float(i);
    if(id>=floor(10.0+u.a.w*8.0)) { break; }
    float a=id*6.283185/18.0+0.06*sin(t*0.13+id);
    vec2 axis=vec2(cos(a),sin(a));
    vec2 side=vec2(-axis.y,axis.x);
    float along=dot(q,axis);
    float lateral=dot(q,side);
    float bend=sin(along*6.0+id)*0.018*smoothstep(0.16,0.7,along);
    float track=abs(lateral-bend);
    float window=smoothstep(0.13,0.2,along)*(1.0-smoothstep(0.75,1.1,along));
    float activation=smoothstep(0.3,0.85,noise(t*0.24+id*19.0));
    glow+=exp(-track*850.0)*window*(0.035+activation*0.065);
    float cycle=t*(0.12+hash(id)*0.18)+hash(id+8.0);
    float life=fract(cycle);
    float outbound=step(0.5,hash(floor(cycle)+id*3.0));
    float pos=mix(0.95-life*0.8,0.15+life*0.8,outbound);
    float packet=exp(-track*650.0-abs(along-pos)*150.0)*window;
    mint+=packet*(0.35+activation)*sin(life*3.14159);
  }
  // A spatial hash gives each micro-node a unique lifetime, speed and depth.
  float flow=t*0.055;
  float turn=0.14*sin(r*9.0-t*0.19)+flow;
  vec2 advected=vec2(q.x*cos(turn)-q.y*sin(turn),q.x*sin(turn)+q.y*cos(turn));
  advected*=1.0+0.12*sin(r*7.0-t*0.45);
  vec2 grid=advected*(24.0+u.a.w*10.0)+vec2(flow*0.7,-flow*0.4);
  vec2 cell=floor(grid);
  for(int y=-1;y<=1;y++) { for(int x=-1;x<=1;x++) {
    vec2 tile=cell+vec2(float(x),float(y));
    float seed=hash(dot(tile,vec2(37.0,113.0)));
    float depth=0.4+seed*0.6;
    float clock=t*(0.15+seed*0.25)+seed*50.0;
    vec2 offset=vec2(noise(clock+seed*39.0),noise(clock+seed*87.0));
    vec2 node=tile+vec2(0.15)+offset*0.7;
    float dist=length(grid-node);
    float activity=smoothstep(0.55,0.9,noise(clock+7.0));
    float lifetime=sin(fract(clock*0.12+seed)*3.14159);
    float density=step(seed,u.a.w);
    glow+=exp(-dist*dist*(110.0+depth*70.0))*depth*(0.08+activity*0.4)*density*lifetime;
    vec2 neighbor=tile+vec2(1.2,0.6)+vec2(sin(clock),cos(clock))*0.15;
    glow+=exp(-line(grid,node,neighbor)*95.0)*activity*0.035*density;
  }}
  // Nested tilted circuits form the software core. Each shell has its own clock.
  for(int i=0;i<5;i++) {
    float id=float(i);
    float spin=t*(0.08+id*0.019)+id*0.72;
    vec2 rotated=vec2(q.x*cos(spin)-q.y*sin(spin),q.x*sin(spin)+q.y*cos(spin));
    float shape=length(rotated*vec2(1.0,1.2+id*0.14));
    float aggregation=noise(t*0.19+id*0.7);
    float radius=0.065+id*(0.023+0.022*aggregation)+sin(t*0.7+id)*0.008;
    float shell=exp(-abs(shape-radius)*700.0);
    float segments=0.3+0.7*smoothstep(-0.1,0.5,sin(angle*(5.0+id)+spin*3.0));
    glow+=shell*segments*0.3;
  }
  float pulse=fract(t*0.18);
  mint+=exp(-abs(r-pulse*0.65)*180.0)*(1.0-pulse)*0.1;
  glow+=exp(-r*28.0)*(0.07+0.025*sin(t*1.7));
  float age=u.c.z;
  vec2 click=(u.c.xy-vec2(0.5))*vec2(aspect,1.0);
  mint+=exp(-abs(length(p-click)-age*0.24)*180.0)*exp(-age*1.6)*0.3;
  float matrix=exp(-min(abs(fract(q.x*48.0)-0.5),abs(fract(q.y*48.0)-0.5))*180.0);
  glow+=matrix*exp(-r*2.0)*0.012;
  float quiet=smoothstep(0.18,0.62,uv.x);
  float grain=(hash(dot(uv*u.a.xy,vec2(13.0,71.0))+floor(t*12.0))-0.5)*0.004;
  float scan=sin(uv.y*u.a.y*1.5+t*0.6)*0.002;
  vec3 color=vec3(0.025,0.032,0.034)+(vec3(0.7,0.79,0.77)*glow+vec3(0.39,0.7,0.58)*mint)*(0.15+quiet*0.85);
  return mix(vec3(0.025,0.032,0.034),color,u.b.w)+vec3(grain+scan)*u.b.w;
}`;

// This deliberately small shader subset is shared to keep both backends identical.
export function shaderSources() {
  const glsl = `#version 300 es
precision highp float;
struct Uniforms { vec4 a; vec4 b; vec4 c; };
uniform Uniforms u;
out vec4 color;
${field}
void main(){color=vec4(scene(vec2(gl_FragCoord.x/u.a.x,1.0-gl_FragCoord.y/u.a.y)),1.0);}`;
  let wgsl = field.replace(/atan\(q.y,q.x\)/g,'atan2(q.y,q.x)');
  wgsl = wgsl.replace(/(float|vec2|vec3) (\w+)\(([^)]*)\)\s*\{/g, (_,type,name,args)=>
    `fn ${name}(${args.replace(/(float|vec2|vec3) (\w+)/g,'$2: $1')}) -> ${type} {`);
  wgsl = wgsl.replace(/for\(int (\w+)=(-?\d+);(\w+)(<=|<)(\d+);\w+\+\+\)/g,
    (_,n,start,v,op,end)=>`for(var ${n}: i32=${start};${v}${op}${end};${n}++)`);
  wgsl = wgsl.replace(/\b(float|vec2|vec3) (\w+)\s*=/g,'var $2 =');
  wgsl = wgsl.replace(/\bfloat\b/g,'f32').replace(/\bvec2\b/g,'vec2f').replace(/\bvec3\b/g,'vec3f');
  return { glsl, wgsl: `struct Uniforms { a: vec4f, b: vec4f, c: vec4f }
@group(0) @binding(0) var<uniform> u: Uniforms;
${wgsl}
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
var p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));return vec4f(p[i],0.,1.);
}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f {return vec4f(scene(p.xy/u.a.xy),1.);}` };
}

async function webgpu(canvas, lost) {
  const adapter=await navigator.gpu?.requestAdapter({powerPreference:'low-power'});
  if(!adapter) throw new Error('WebGPU unavailable');
  const device=await adapter.requestDevice();
  let disposed=false;
  try {
    const module=device.createShaderModule({code:shaderSources().wgsl});
    const info=await module.getCompilationInfo();
    if(info.messages.some(m=>m.type==='error')) throw new Error(info.messages.map(m=>m.message).join('\n'));
    const format=navigator.gpu.getPreferredCanvasFormat();
    const pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragment',targets:[{format}]},primitive:{topology:'triangle-list'}});
  const context=canvas.getContext('webgpu');
    if(!context) throw new Error('WebGPU canvas unavailable');
    context.configure({device,format,alphaMode:'opaque'});
    const buffer=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]});
    device.lost.then(()=>{if(!disposed)lost();});
    return {kind:'webgpu',draw(values){device.queue.writeBuffer(buffer,0,values);const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();device.queue.submit([encoder.finish()]);},dispose(){disposed=true;buffer.destroy();context.unconfigure();device.destroy();}};
  } catch(error) { device.destroy(); throw error; }
}

function webgl(canvas, lost) {
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,powerPreference:'low-power'});
  if(!gl) throw new Error('WebGL2 unavailable');
  const shaders=[];
  const compile=(type,source)=>{const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram();
  try {
    gl.attachShader(program,compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}'));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,shaderSources().glsl));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  } catch(e){shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);throw e;}
  const locations=['a','b','c'].map(n=>gl.getUniformLocation(program,`u.${n}`));
  const onLost=e=>{e.preventDefault();lost();};canvas.addEventListener('webglcontextlost',onLost);
  return {kind:'webgl2',draw(values){gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);locations.forEach((l,i)=>gl.uniform4fv(l,values.subarray(i*4,i*4+4)));gl.drawArrays(gl.TRIANGLES,0,3);},dispose(){canvas.removeEventListener('webglcontextlost',onLost);shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}};
}

export function mountComputeBackground(host) {
  if (!host) return () => {};
  let stopped=false,renderer,canvas,frame=0,last=0,time=0,clickTime=-100,quality=1,slow=0;
  const coarse=matchMedia('(pointer: coarse)');
  const narrow=matchMedia('(max-width: 700px)');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const low=coarse.matches||narrow.matches||(navigator.hardwareConcurrency||4)<=4||(navigator.deviceMemory||8)<=4||navigator.connection?.saveData;
  quality=low?0.65:1;
  const values=new Float32Array(12);values[4]=values[5]=-2;
  let pointerX=-2,pointerY=-2;
  const resize=()=>{if(!canvas)return;const small=low||narrow.matches;const scale=Math.min(devicePixelRatio||1,small?1:1.4)*quality;const budget=small?420000:1200000;const w=host.clientWidth,h=host.clientHeight;const d=Math.min(scale,Math.sqrt(budget/Math.max(1,w*h)));const width=Math.max(1,Math.round(w*d)),height=Math.max(1,Math.round(h*d));if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;};
  const tick=now=>{if(stopped||document.hidden||!renderer)return;frame=requestAnimationFrame(tick);const dt=now-last;const interval=reduced.matches?1000/10:(low||narrow.matches||quality<0.6)?1000/30:1000/60;if(dt<interval-1)return;last=now;time+=Math.min(dt/1000,0.1)*(reduced.matches?0.08:1);values.set([canvas.width,canvas.height,time,quality]);values[4]+=(pointerX-values[4])*Math.min(1,dt/140);values[5]+=(pointerY-values[5])*Math.min(1,dt/140);values[6]=coarse.matches||narrow.matches||reduced.matches?0:1;values[7]=reduced.matches?0.4:0.7+quality*0.3;values[10]=time-clickTime;
    try{renderer.draw(values);}catch{fallback();return;}
    if(!reduced.matches&&dt>interval*1.8)slow++;else slow=Math.max(0,slow-1);
    if(slow>35&&quality>0.4){quality=Math.max(0.4,quality-0.15);resize();slow=0;}
  };
  const visibility=()=>{cancelAnimationFrame(frame);last=performance.now();if(!document.hidden&&!stopped)frame=requestAnimationFrame(tick);};
  const pointer=e=>{if(!coarse.matches&&!narrow.matches){pointerX=e.clientX/innerWidth;pointerY=e.clientY/innerHeight;}};
  const click=e=>{if(coarse.matches||narrow.matches||reduced.matches)return;values[8]=e.clientX/innerWidth;values[9]=e.clientY/innerHeight;clickTime=time;};
  const createCanvas=()=>{canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');host.replaceChildren(canvas);resize();return canvas;};
  const fallback=()=>{if(stopped)return;cancelAnimationFrame(frame);renderer?.dispose();renderer=null;try{renderer=webgl(createCanvas(),()=>{cancelAnimationFrame(frame);renderer?.dispose();renderer=null;host.dataset.renderer='unavailable';});host.dataset.renderer=renderer.kind;visibility();}catch{host.dataset.renderer='unavailable';}};
  const observer=new ResizeObserver(resize);observer.observe(host);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('resize',resize,{passive:true});window.addEventListener('pointermove',pointer,{passive:true});window.addEventListener('click',click,{passive:true});reduced.addEventListener('change',visibility);
  (async()=>{try{const result=await webgpu(createCanvas(),()=>{if(!stopped)fallback();});if(stopped){result.dispose();return;}renderer=result;host.dataset.renderer=result.kind;visibility();}catch{fallback();}})();
  return ()=>{stopped=true;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize);window.removeEventListener('pointermove',pointer);window.removeEventListener('click',click);reduced.removeEventListener('change',visibility);renderer?.dispose();host.replaceChildren();delete host.dataset.renderer;};
}
