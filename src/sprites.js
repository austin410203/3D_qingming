// sprites.js — instanced painted sprites (Gemini sheets in the scroll's gongbi style).
// One shader serves both views: 3D = cylindrical billboards standing on the ground,
// 2D = flat quads in strip-pixel space drawn over the painting.
import * as THREE from 'three';

export async function loadAtlas(name) {
  const [meta, tex] = await Promise.all([
    fetch(`assets/sprites/${name}.json`).then(r => r.json()),
    new THREE.TextureLoader().loadAsync(`assets/sprites/${name}.webp`),
  ]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { meta, tex, names: Object.keys(meta.items) };
}

const VERT = /* glsl */`
  attribute vec3 iPos; attribute vec2 iSize; attribute vec4 iUV; attribute vec4 iAnim;
  uniform float u2D, uTime, uSway;
  varying vec2 vUv; varying float vFade; varying float vY;
  #include <fog_pars_vertex>
  void main() {
    float flip = iAnim.x, ph = iAnim.y, walk = iAnim.z;
    vec2 q = position.xy;                         // x in [-.5,.5], y in [0,1]
    // walking: body bob + legs shear (lower third swings) ; trees: crown sway
    float s = sin(ph);
    q.x += walk * s * 0.10 * max(0.0, 0.34 - q.y) / 0.34;
    q.y += walk * abs(cos(ph)) * 0.025;
    q.x += uSway * (1.0 - walk) * q.y * q.y * 0.025 * sin(uTime * 1.3 + iPos.x * 0.31 + iPos.z * 0.17);
    vUv = vec2(iUV.x + (flip < 0.0 ? 1.0 - (position.x + 0.5) : position.x + 0.5) * iUV.z, 1.0 - (iUV.y + (1.0 - position.y) * iUV.w));
    vFade = iAnim.w; vY = position.y;
    vec4 mvPosition;
    if (u2D > 0.5) {
      mvPosition = modelViewMatrix * vec4(iPos.x + q.x * iSize.x, iPos.y + q.y * iSize.y, iPos.z, 1.0);
    } else {
      vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      camR = normalize(vec3(camR.x, 0.0, camR.z) + 1e-5);
      vec3 wp = iPos + camR * q.x * iSize.x + vec3(0.0, q.y * iSize.y, 0.0);
      mvPosition = viewMatrix * vec4(wp, 1.0);
      // lean the card slightly toward the camera so it never reads as a sliver from above
      mvPosition.z += q.y * iSize.y * 0.15;
    }
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */`
  uniform sampler2D map; uniform float u2D, uAlphaCut;
  uniform vec3 uTint;
  varying vec2 vUv; varying float vFade; varying float vY;
  #include <fog_pars_fragment>
  void main() {
    vec4 c = texture2D(map, vUv);
    if (c.a < uAlphaCut || vFade < 0.01) discard;
    gl_FragColor = vec4(c.rgb * uTint, u2D > 0.5 ? c.a * vFade : 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export class SpriteLayer {
  constructor(atlas, max, { is2D = false, sway = 0, alphaCut = 0.5, tint = [1, 1, 1] } = {}) {
    this.atlas = atlas; this.max = max; this.count = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = n => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aPos = mk(3); this.aSize = mk(2); this.aUV = mk(4); this.aAnim = mk(4);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSize', this.aSize); g.setAttribute('iUV', this.aUV); g.setAttribute('iAnim', this.aAnim);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, map: { value: atlas.tex }, u2D: { value: is2D ? 1 : 0 }, uTime: { value: 0 },
        uSway: { value: sway }, uAlphaCut: { value: is2D ? 0.04 : alphaCut }, uTint: { value: new THREE.Vector3(...tint) } },
      vertexShader: VERT, fragmentShader: FRAG, fog: !is2D, transparent: is2D, depthWrite: !is2D, depthTest: !is2D,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
  }
  // write instance i
  set(i, name, x, y, z, w, h, flip, phase, walk, fade = 1) {
    const it = this.atlas.meta.items[name];
    this.aPos.array.set([x, y, z], i * 3);
    this.aSize.array.set([w, h], i * 2);
    this.aUV.array.set([it.u, it.v, it.w, it.h], i * 4);
    this.aAnim.array.set([flip, phase, walk, fade], i * 4);
  }
  commit(n) {
    this.count = this.geo.instanceCount = n;
    for (const a of [this.aPos, this.aSize, this.aUV, this.aAnim]) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); }
  }
  aspect(name) { const it = this.atlas.meta.items[name]; return it.px / it.py; }
}
