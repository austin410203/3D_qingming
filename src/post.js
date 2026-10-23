// post.js — makes the 3D render read like ink & mineral colour on aged silk:
// depth/normal ink outlines, palette grade toward the scroll, silk weave + mottling, darkened edges.
// Also the ink-wash dissolve that blends the flat scroll into the 3D world.
import * as THREE from 'three';

const QUAD_V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const SILK_GLSL = `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 w = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i+vec2(1,0)), w.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), w.x), w.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
  // silk: fine warp/weft threads, slubs, age mottling
  vec3 silk(vec3 c, vec2 px, vec2 uv){
    float warp = 0.5 + 0.5 * sin(px.x * 2.1 + vn(px * vec2(0.02, 0.6)) * 3.0);
    float weft = 0.5 + 0.5 * sin(px.y * 2.3 + vn(px * vec2(0.6, 0.02)) * 3.0);
    float threads = mix(warp, weft, 0.5);
    float slub = smoothstep(0.72, 0.95, vn(px * vec2(0.012, 0.35)));
    float mott = fbm(uv * vec2(3.0, 2.0) + 7.0);
    c *= 0.955 + threads * 0.06;
    c *= 1.0 - slub * 0.04;
    c *= 0.96 + mott * 0.08;
    return c;
  }
`;

export class PaintPost {
  constructor(renderer) {
    this.r = renderer;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rtColor = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples: 4 });
    this.rtColor.depthTexture = new THREE.DepthTexture(s.x, s.y);
    this.rtNormal = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType });
    this.rtNormal.depthTexture = new THREE.DepthTexture(s.x, s.y);
    this.normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.rtColor.texture }, tNormal: { value: this.rtNormal.texture }, tDepth: { value: this.rtColor.depthTexture },
        tNDepth: { value: this.rtNormal.depthTexture }, res: { value: s.clone() }, uNear: { value: 0.1 }, uFar: { value: 3000 }, uTime: { value: 0 }, uDebug: { value: 0 } },
      vertexShader: QUAD_V,
      fragmentShader: `
        uniform sampler2D tColor, tNormal, tDepth, tNDepth; uniform vec2 res; uniform float uNear, uFar, uTime, uDebug;
        varying vec2 vUv;
        ${SILK_GLSL}
        float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float D(vec2 uv){ return lin(texture2D(tDepth, uv).x); }
        vec3 N(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
        void main(){
          vec2 px = 1.0 / res;
          vec3 c = texture2D(tColor, vUv).rgb;
          float d0 = D(vUv);
          vec3 n0 = N(vUv);
          float nd0 = texture2D(tNDepth, vUv).x;
          float de = 0.0, ne = 0.0;
          float w = clamp(res.y / 600.0, 1.2, 2.4);
          for (int i = 0; i < 8; i++) {
            vec2 o = (i == 0 ? vec2(1,0) : i == 1 ? vec2(-1,0) : i == 2 ? vec2(0,1) : i == 3 ? vec2(0,-1) :
                      i == 4 ? vec2(1,1) : i == 5 ? vec2(-1,1) : i == 6 ? vec2(1,-1) : vec2(-1,-1)) * px * w;
            float d1 = D(vUv + o);
            de = max(de, (d0 - d1) / d0);                         // only the far side of a silhouette gets the line
            if (nd0 < 1.0) ne = max(ne, 1.0 - dot(n0, N(vUv + o)));
          }
          float dist = smoothstep(80.0, 700.0, d0);
          float edge = max(smoothstep(0.05, 0.16, de), smoothstep(0.3, 0.7, ne) * 0.8) * (1.0 - dist * 0.75);
          // wobble the line darkness like a brush
          edge *= 0.75 + 0.35 * vn(gl_FragCoord.xy * 0.08 + uTime * 0.0);
          if (uDebug > 0.5) { gl_FragColor = vec4(uDebug > 1.5 ? vec3(fract(d0 / 50.0)) : vec3(de * 5.0, ne, edge), 1.0); return; }
          vec3 ink = vec3(0.20, 0.15, 0.10);
          c = mix(c, ink * (0.5 + 0.3 * c), clamp(edge, 0.0, 1.0) * 0.92);
          // palette grade: mineral colours on aged silk
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(l), c, 0.92);
          c = c * vec3(1.0, 0.97, 0.88) + vec3(0.012, 0.01, 0.0);
          c = mix(c, vec3(0.72, 0.63, 0.44), 0.06);
          c = silk(c, gl_FragCoord.xy, vUv);
          vec2 q = vUv - 0.5; c *= 1.0 - dot(q * vec2(0.9, 1.2), q * vec2(0.9, 1.2)) * 0.3;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false;
    this.ps = new THREE.Scene(); this.ps.add(this.quad);
    this.pc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  resize() {
    const s = this.r.getDrawingBufferSize(new THREE.Vector2());
    this.rtColor.setSize(s.x, s.y); this.rtNormal.setSize(s.x, s.y); this.mat.uniforms.res.value.copy(s);
  }
  render(scene, camera, target = null, t = 0) {
    const r = this.r;
    this.mat.uniforms.uNear.value = camera.near; this.mat.uniforms.uFar.value = camera.far; this.mat.uniforms.uTime.value = t;
    camera.layers.enableAll();
    r.setRenderTarget(this.rtColor); r.render(scene, camera);
    // normals only for solid geometry (layer 0): no lines inside water, sky or painted cards
    const bg = scene.background, fog = scene.fog;
    scene.overrideMaterial = this.normalMat; scene.background = null; scene.fog = null;
    camera.layers.set(0);
    r.setRenderTarget(this.rtNormal); r.setClearColor(0x8080ff, 1); r.clear(); r.render(scene, camera);
    camera.layers.enableAll();
    scene.overrideMaterial = null; scene.background = bg; scene.fog = fog;
    r.setRenderTarget(target); r.render(this.ps, this.pc);
  }
}

// ink-wash dissolve between the flat scroll (A) and the 3D world (B)
export class Dissolve {
  constructor(renderer) {
    this.r = renderer;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const mk = () => new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType });
    this.a = mk(); this.b = mk();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tA: { value: this.a.texture }, tB: { value: this.b.texture }, uK: { value: 0 }, res: { value: s.clone() } },
      vertexShader: QUAD_V,
      fragmentShader: `uniform sampler2D tA, tB; uniform float uK; uniform vec2 res; varying vec2 vUv;
        ${SILK_GLSL}
        void main(){
          vec2 p = vUv * vec2(res.x / res.y, 1.0);
          float n = fbm(p * 3.0) * 0.75 + fbm(p * 14.0) * 0.25;
          n = mix(n, 1.0 - length(vUv - 0.5) * 1.2, 0.35);        // blooms from the centre outward
          float k = uK * 1.25 - 0.12;
          float m = smoothstep(n - 0.03, n + 0.03, k);
          float rim = smoothstep(0.0, 0.03, k - n + 0.03) * (1.0 - smoothstep(0.03, 0.1, k - n + 0.03));
          vec3 c = mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, m);
          c = mix(c, vec3(0.03, 0.02, 0.01), rim * 0.55);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false;
    this.ps = new THREE.Scene(); this.ps.add(this.quad);
    this.pc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  resize() { const s = this.r.getDrawingBufferSize(new THREE.Vector2()); this.a.setSize(s.x, s.y); this.b.setSize(s.x, s.y); this.mat.uniforms.res.value.copy(s); }
  render(k) { this.mat.uniforms.uK.value = k; this.r.setRenderTarget(null); this.r.render(this.ps, this.pc); }
}
