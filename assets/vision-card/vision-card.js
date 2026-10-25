/*
 * Vision card: a brand silhouette drawn as fine vertical lines (WebGL), a
 * pointer-driven local brightening of those lines, and machine-vision style
 * detection boxes (SVG) that appear where the pointer passes.
 *
 *   var card = VisionCard.mount(el, {
 *     mask: VisionCardMasks.discord,          // see masks.js
 *     theme: { line: '#ffffff', box: '#ff3fd4' },
 *     params: { pitch: 4 },                    // any key of VisionCard.DEFAULTS
 *     seed: 1
 *   });
 *   card.setParams({ maxBoxes: 6 });
 *   card.destroy();
 *
 * The card's own markup (logo, copy, link) is left alone; the effect is
 * inserted behind it as `.vcard__art` and never takes pointer events.
 *
 * All motion runs on simulated seconds advanced by step(dt), never on frame
 * count, so a fixed dt and a fixed pointer path give the same frame every time
 * (see the replay mode on /labs/vision-card).
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    // pattern
    pitch: 4,            // css px between line centres
    lineWidth: 1,        // css px; under one device pixel the line dims instead of thinning
    maskScale: 0.78,     // silhouette width as a fraction of the card width
    maskX: 0.5,          // silhouette centre, fraction of card width
    maskY: 0.45,         // silhouette centre, fraction of card height
    base: 0.62,          // line brightness inside the silhouette
    outside: 0.07,       // line brightness outside it
    contrast: 0.6,       // how unequal neighbouring lines are, 0..1
    noise: 0.45,         // amount of slow light/dark variation along each line
    noiseSpeed: 0.5,     // flicker speed of that variation
    flow: 0.06,          // downward drift of the variation
    rain: 0.16,          // share of lines carrying a short bright streak
    rainSpeed: 0.16,     // card heights per second, roughly
    rainLength: 0.07,    // streak length, fraction of card height
    rainOutside: 0.2,    // streak brightness outside the silhouette, relative
    // pointer
    radius: 64,          // css px, influence radius
    boost: 1.5,          // brightness gain at the centre of the influence
    jitter: 0.15,        // css px, largest sideways shift of lines under the pointer
    sparkle: 0.5,        // per-line brightness flicker under the pointer, 0..1
    smoothing: 0.07,     // s, pointer smoothing time constant
    trailDecay: 0.45,    // s, how long the trail behind the pointer stays lit
    trailStrength: 0.55, // brightness of a fresh trail point relative to the pointer
    hoverIn: 0.1,        // s, fade-in time constant on enter
    hoverOut: 0.45,      // s, fade-out time constant on leave
    // detection boxes
    boxes: true,
    maxBoxes: 4,         // most boxes alive at once
    boxMin: 26,          // css px, smallest box side
    boxMax: 92,          // css px, largest box side
    spawnInterval: 0.3,  // s, shortest gap between two boxes
    spawnSpread: 56,     // css px, how far from the pointer a box may centre
    boxLife: 0.85,       // s, time fully shown
    boxFadeIn: 0.06,     // s
    boxFadeOut: 0.3,     // s
    linkChance: 0.55,    // chance a new box is linked to its nearest neighbour
    linkMaxDist: 150,    // css px
    labels: 'conf',      // 'conf' (0.93), 'id' (#07), 'both', 'none'
    // optional whole-card sweep; off until the reference shows what triggers it
    sweep: 'off',        // 'off' | 'enter' (first enter only) | 'inview' (first time on screen)
    sweepDuration: 1.1   // s
  };

  var MAX_PTS = 24;
  var DPR_CAP = 2;

  var VERT = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}';

  var FRAG = [
    'precision highp float;',
    'uniform vec2 uRes;uniform float uDpr;uniform float uTime;',
    'uniform sampler2D uMask;uniform vec4 uMaskRect;',
    'uniform float uPitch,uWidth,uBase,uOutside,uContrast,uNoise,uNoiseSpeed,uFlow;',
    'uniform float uRain,uRainSpeed,uRainLen,uRainOut;',
    'uniform float uRadius,uBoost,uJitter,uSparkle,uSweep;',
    'uniform vec3 uColor;uniform vec3 uPts[' + MAX_PTS + '];uniform int uCount;',
    'float h1(float n){return fract(sin(n*127.1)*43758.5453);}',
    'float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    '  return mix(mix(h2(i),h2(i+vec2(1.,0.)),f.x),mix(h2(i+vec2(0.,1.)),h2(i+vec2(1.,1.)),f.x),f.y);}',
    'void main(){',
    '  vec2 size=uRes/uDpr;',
    '  vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;',
    // pointer influence: sum of gaussians over the pointer and its trail
    '  float f=0.;',
    '  for(int i=0;i<' + MAX_PTS + ';i++){if(i>=uCount)break;vec2 d=p-uPts[i].xy;f+=uPts[i].z*exp(-dot(d,d)/(uRadius*uRadius));}',
    '  f=min(f,1.5);',
    // lines under the pointer shift sideways by a fraction of a pixel; slow in y, so no visible waves
    '  float c0=floor(p.x/uPitch);',
    '  float xs=p.x+(vn(vec2(c0*.7,p.y*.015+uTime*3.))-.5)*2.*uJitter*f;',
    '  float col=floor(xs/uPitch);float cx=(col+.5)*uPitch;',
    '  float aa=.5/uDpr;float hw=max(uWidth*.5,aa);',
    '  float line=1.-smoothstep(hw-aa,hw+aa,abs(xs-cx));',
    '  line*=clamp(uWidth*uDpr,0.,1.);',
    // the silhouette is sampled at the line centre, so lines end cleanly at its edge
    '  vec2 muv=(vec2(cx,p.y)/size-uMaskRect.xy)/uMaskRect.zw;',
    '  float m=0.;',
    '  if(muv.x>=0.&&muv.x<=1.&&muv.y>=0.&&muv.y<=1.)m=texture2D(uMask,muv).a;',
    '  float hc=h1(col*1.37+3.1);',
    '  float colB=mix(1.-uContrast,1.,hc);',
    '  float body=vn(vec2(col*.31,p.y*.012-uTime*uFlow*(.5+hc)));',
    '  float flick=vn(vec2(col*.53+11.,uTime*uNoiseSpeed));',
    '  float lum=m*uBase*colB*mix(1.,body*1.4,uNoise)*mix(1.,.6+.8*flick,uNoise);',
    // rain: a short streak per chosen line, brightest at its leading (lower) end
    '  float hr=h1(col*2.71+9.2);',
    '  float has=step(1.-uRain,h1(col*5.13+1.7));',
    '  float ph=fract(p.y/size.y*1.3-uTime*uRainSpeed*(.6+hr)+hr*13.);',
    '  float streak=has*smoothstep(0.,uRainLen,ph)*step(ph,uRainLen);',
    '  lum+=streak*mix(uRainOut,1.,m)*.85;',
    '  lum+=uOutside*colB;',
    '  float spk=vn(vec2(col*.91+5.,uTime*9.));',
    '  lum*=(1.+uBoost*f)*mix(1.,.35+1.3*spk,uSparkle*min(f,1.));',
    '  if(uSweep>=0.){float bx=mix(-.25,1.25,uSweep)*size.x;float g=(p.x-bx)/(.09*size.x);lum+=exp(-g*g)*(.15+.85*m)*.9;}',
    '  float a=clamp(lum*line,0.,1.);',
    '  gl_FragColor=vec4(uColor*a,a);',
    '}'
  ].join('\n');

  var SVGNS = 'http://www.w3.org/2000/svg';

  // Seeded PRNG (mulberry32) so box placement replays identically.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function svgEl(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function approach(cur, target, tau, dt) {
    if (tau <= 0) return target;
    return target + (cur - target) * Math.exp(-dt / tau);
  }

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // ---------------------------------------------------------------- mask

  function buildMask(mask, done) {
    var c = document.createElement('canvas');
    var g = c.getContext('2d');
    if (mask.src) {
      var img = new Image();
      img.onload = function () {
        var w = 512, h = Math.max(1, Math.round(512 * img.naturalHeight / img.naturalWidth));
        c.width = w; c.height = h;
        g.drawImage(img, 0, 0, w, h);
        done(c, w / h);
      };
      img.src = mask.src;
      return;
    }
    var vb = mask.viewBox, W = 512, H = Math.round(512 * vb[1] / vb[0]);
    c.width = W; c.height = H;
    g.scale(W / vb[0], H / vb[1]);
    g.fillStyle = '#fff';
    g.fill(new Path2D(mask.path), 'evenodd');
    done(c, vb[0] / vb[1]);
  }

  // ---------------------------------------------------------------- card

  function Card(el, opts) {
    opts = opts || {};
    this.el = el;
    this.p = {};
    var k;
    for (k in DEFAULTS) this.p[k] = DEFAULTS[k];
    for (k in (opts.params || {})) this.p[k] = opts.params[k];
    this.theme = { line: '#ffffff', box: '#ffffff' };
    for (k in (opts.theme || {})) this.theme[k] = opts.theme[k];
    this.seed = opts.seed == null ? 1 : opts.seed;
    this.frames = 0;
    this.running = false;
    this.visible = true;
    this.external = false; // true while a caller drives step()/render() itself

    var mm = global.matchMedia ? global.matchMedia.bind(global) : function () { return { matches: false }; };
    this.reduced = mm('(prefers-reduced-motion: reduce)').matches;
    this.coarse = mm('(hover: none)').matches;

    this._buildDom();
    this.reset();
    this._initGl();
    this._listen();
    var self = this;
    buildMask(opts.mask || global.VisionCardMasks.discord, function (canvas, aspect) {
      if (self.destroyed) return;
      self.maskCanvas = canvas;
      self.maskAspect = aspect;
      self.maskData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      self._uploadMask();
      self._resize();
      self.render();
      self._kick();
    });
  }

  Card.prototype._buildDom = function () {
    var art = document.createElement('div');
    art.className = 'vcard__art';
    art.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.svg = svgEl('svg', { 'class': 'vcard__boxes' });
    this.linkLayer = svgEl('g', {});
    this.boxLayer = svgEl('g', {});
    this.svg.appendChild(this.linkLayer);
    this.svg.appendChild(this.boxLayer);
    art.appendChild(this.canvas);
    art.appendChild(this.svg);
    this.el.insertBefore(art, this.el.firstChild);
    this.art = art;
    this.boxNodes = [];
    this.linkNodes = [];
  };

  Card.prototype._boxNode = function (i) {
    while (this.boxNodes.length <= i) {
      var g = svgEl('g', { 'class': 'vcard__box' });
      var r = svgEl('rect', { 'class': 'vcard__box-frame' });
      var c = svgEl('path', { 'class': 'vcard__box-corners' });
      var t = svgEl('text', { 'class': 'vcard__box-label' });
      g.appendChild(r); g.appendChild(c); g.appendChild(t);
      this.boxLayer.appendChild(g);
      this.boxNodes.push({ g: g, r: r, c: c, t: t });
    }
    return this.boxNodes[i];
  };

  Card.prototype._linkNode = function (i) {
    while (this.linkNodes.length <= i) {
      var l = svgEl('line', { 'class': 'vcard__link' });
      this.linkLayer.appendChild(l);
      this.linkNodes.push(l);
    }
    return this.linkNodes[i];
  };

  // Back to the state at t = 0: no pointer, no boxes, seeded PRNG restarted.
  Card.prototype.reset = function () {
    this.t = 0;
    this.rand = rng(this.seed);
    this.ptr = { x: 0, y: 0, inside: false };
    this.sm = { x: 0, y: 0 };
    this.wasInside = false;
    this.hover = 0;
    this.trail = [];
    this.pulses = [];
    this.boxes = [];
    this.links = [];
    this.nextId = 1;
    this.lastSpawn = -1e9;
    this.travel = 0;
    this.sweepStart = null;
    this.sweepDone = false;
  };

  Card.prototype.setParams = function (patch) {
    for (var k in patch) this.p[k] = patch[k];
    if ('maskScale' in patch || 'maskX' in patch || 'maskY' in patch) this._layoutMask();
    this.render();
    this._kick();
  };

  Card.prototype.setTheme = function (patch) {
    for (var k in patch) this.theme[k] = patch[k];
    this.render();
  };

  // ---------------------------------------------------------------- gl

  Card.prototype._initGl = function () {
    var gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) { this.gl = null; return; }
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('VisionCard shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('VisionCard link: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var names = ['uRes', 'uDpr', 'uTime', 'uMask', 'uMaskRect', 'uPitch', 'uWidth', 'uBase', 'uOutside', 'uContrast',
      'uNoise', 'uNoiseSpeed', 'uFlow', 'uRain', 'uRainSpeed', 'uRainLen', 'uRainOut', 'uRadius', 'uBoost', 'uJitter', 'uSparkle',
      'uSweep', 'uColor', 'uPts', 'uCount'];
    this.u = {};
    for (var i = 0; i < names.length; i++) this.u[names[i]] = gl.getUniformLocation(prog, names[i]);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.uniform1i(this.u.uMask, 0);
    this.prog = prog;
    this.buf = buf;
    this.pts = new Float32Array(MAX_PTS * 3);
    this.gl = gl;
  };

  Card.prototype._uploadMask = function () {
    var gl = this.gl;
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.maskCanvas);
  };

  // Silhouette rectangle in card-normalised coordinates [x0, y0, w, h].
  Card.prototype._layoutMask = function () {
    if (!this.w || !this.maskAspect) return;
    var w = this.p.maskScale;
    var h = w * this.w / this.maskAspect / this.h;
    this.maskRect = [this.p.maskX - w / 2, this.p.maskY - h / 2, w, h];
  };

  Card.prototype._resize = function () {
    var r = this.art.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = r.width;
    this.h = r.height;
    this.dpr = Math.min(global.devicePixelRatio || 1, DPR_CAP);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.svg.setAttribute('viewBox', '0 0 ' + this.w + ' ' + this.h);
    this._layoutMask();
    if (!this.gl) this._drawFallback();
  };

  // Mask coverage (0..1) at a card point, read on the CPU for box placement.
  Card.prototype.maskAt = function (x, y) {
    if (!this.maskRect || !this.maskData) return 0;
    var mr = this.maskRect;
    var u = (x / this.w - mr[0]) / mr[2], v = (y / this.h - mr[1]) / mr[3];
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    var d = this.maskData;
    var px = Math.min(d.width - 1, Math.floor(u * d.width)), py = Math.min(d.height - 1, Math.floor(v * d.height));
    return d.data[(py * d.width + px) * 4 + 3] / 255;
  };

  // No WebGL: the static silhouette, drawn once with the 2D canvas.
  Card.prototype._drawFallback = function () {
    if (!this.maskRect) return;
    var g = this.canvas.getContext('2d');
    if (!g) return;
    var p = this.p, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = this.theme.line;
    for (var x = p.pitch / 2; x < this.w; x += p.pitch) {
      var y0 = null;
      for (var y = 0; y <= this.h; y += 1) {
        var on = y < this.h && this.maskAt(x, y) > 0.5;
        if (on && y0 === null) y0 = y;
        if (!on && y0 !== null) { g.globalAlpha = p.base * 0.8; g.fillRect(x - p.lineWidth / 2, y0, p.lineWidth, y - y0); y0 = null; }
      }
    }
  };

  // ---------------------------------------------------------------- input

  Card.prototype._listen = function () {
    var self = this, el = this.el;
    function local(e) {
      var r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    this._on = {
      enter: function (e) {
        if (e.pointerType === 'touch') return;
        var q = local(e);
        self.ptr.x = q.x; self.ptr.y = q.y; self.ptr.inside = true;
        self._kick();
      },
      move: function (e) {
        if (e.pointerType === 'touch') return;
        var q = local(e);
        self.ptr.x = q.x; self.ptr.y = q.y; self.ptr.inside = true;
        self._kick();
      },
      leave: function (e) {
        if (e.pointerType === 'touch') return;
        self.ptr.inside = false;
        self._kick();
      },
      // Touch: a single short pulse where the finger lands. No preventDefault,
      // so the page keeps scrolling.
      down: function (e) {
        if (e.pointerType !== 'touch') return;
        var q = local(e);
        self.touch(q.x, q.y);
      },
      visibility: function () { self._kick(); }
    };
    el.addEventListener('pointerenter', this._on.enter, { passive: true });
    el.addEventListener('pointermove', this._on.move, { passive: true });
    el.addEventListener('pointerleave', this._on.leave, { passive: true });
    el.addEventListener('pointerdown', this._on.down, { passive: true });
    document.addEventListener('visibilitychange', this._on.visibility);

    if (global.ResizeObserver) {
      this.ro = new ResizeObserver(function () { self._resize(); self.render(); });
      this.ro.observe(this.art);
    }
    if (global.IntersectionObserver) {
      this.io = new IntersectionObserver(function (entries) {
        self.visible = entries[entries.length - 1].isIntersecting;
        if (self.visible && self.p.sweep === 'inview' && !self.sweepDone) self._startSweep();
        self._kick();
      });
      this.io.observe(this.el);
    }
  };

  // Feed a pointer position directly (card css px). Used by replay and tests.
  Card.prototype.setPointer = function (x, y, inside) {
    this.ptr.x = x; this.ptr.y = y; this.ptr.inside = !!inside;
    this._kick();
  };

  Card.prototype.touch = function (x, y) {
    this.pulses.push({ x: x, y: y, t0: this.t });
    this.sm.x = x; this.sm.y = y;
    if (this.p.boxes && !this.reduced) {
      this._spawn(x, y);
      this._spawn(x, y);
    }
    this._kick();
  };

  Card.prototype._startSweep = function () {
    this.sweepStart = this.t;
    this.sweepDone = true;
  };

  // ---------------------------------------------------------------- simulation

  Card.prototype.step = function (dt) {
    var p = this.p;
    this.t += dt;
    var t = this.t, ptr = this.ptr;

    if (ptr.inside && !this.wasInside) {
      // Start the smoothed pointer where the real one entered; carrying the
      // old position over would draw a streak across the card.
      this.sm.x = ptr.x; this.sm.y = ptr.y;
      this.lastTrail = { x: ptr.x, y: ptr.y, t: t };
      if (p.sweep === 'enter' && !this.sweepDone) this._startSweep();
    }
    this.wasInside = ptr.inside;

    this.hover = approach(this.hover, ptr.inside ? 1 : 0, ptr.inside ? p.hoverIn : p.hoverOut, dt);
    if (ptr.inside) {
      var k = p.smoothing > 0 ? 1 - Math.exp(-dt / p.smoothing) : 1;
      var nx = this.sm.x + (ptr.x - this.sm.x) * k, ny = this.sm.y + (ptr.y - this.sm.y) * k;
      this.travel += Math.hypot(nx - this.sm.x, ny - this.sm.y);
      this.sm.x = nx; this.sm.y = ny;

      var lt = this.lastTrail;
      if (Math.hypot(nx - lt.x, ny - lt.y) > p.radius * 0.25 || t - lt.t > 0.08) {
        this.trail.push({ x: nx, y: ny, t0: t });
        this.lastTrail = { x: nx, y: ny, t: t };
      }
    }
    var cut = p.trailDecay * 5;
    while (this.trail.length && (t - this.trail[0].t0 > cut || this.trail.length > MAX_PTS - 4)) this.trail.shift();
    while (this.pulses.length && t - this.pulses[0].t0 > 1.5) this.pulses.shift();

    // Boxes come from pointer movement, never per frame: one at most every
    // spawnInterval, and only once the pointer has travelled a little.
    if (p.boxes && !this.reduced && ptr.inside && this.hover > 0.5 &&
        t - this.lastSpawn >= p.spawnInterval && this.travel > p.boxMin * 0.6) {
      this._spawn(this.sm.x, this.sm.y);
    }

    var live = [];
    for (var i = 0; i < this.boxes.length; i++) {
      var b = this.boxes[i];
      b.a = this._boxAlpha(b);
      if (t - b.born < b.fadeAt + p.boxFadeOut) live.push(b);
    }
    this.boxes = live;
    this.links = this.links.filter(function (l) { return live.indexOf(l.a) >= 0 && live.indexOf(l.b) >= 0; });

    if (this.sweepStart !== null && t - this.sweepStart > p.sweepDuration) this.sweepStart = null;
  };

  Card.prototype._boxAlpha = function (b) {
    var age = this.t - b.born, p = this.p;
    var a = p.boxFadeIn > 0 ? Math.min(1, age / p.boxFadeIn) : 1;
    if (age > b.fadeAt) a *= 1 - smoothstep(0, p.boxFadeOut, age - b.fadeAt);
    return Math.max(0, a);
  };

  Card.prototype._spawn = function (cx, cy) {
    var p = this.p, R = this.rand, t = this.t;
    if (!this.w) return;
    var best = null;
    for (var tries = 0; tries < 6; tries++) {
      var side = p.boxMin + (p.boxMax - p.boxMin) * Math.pow(R(), 1.6);
      var w = side, h = side * (0.65 + R() * 0.7);
      var x = cx + (R() * 2 - 1) * p.spawnSpread - w / 2;
      var y = cy + (R() * 2 - 1) * p.spawnSpread - h / 2;
      // Snap the sides to the line grid so frames sit between lines.
      x = Math.round(x / p.pitch) * p.pitch;
      w = Math.max(p.pitch * 3, Math.round(w / p.pitch) * p.pitch);
      // Keep boxes over the silhouette's bounds, clear of the header and copy.
      var mr = this.maskRect, pad = 8;
      x = Math.max(Math.max(4, mr[0] * this.w - pad), Math.min(Math.min(this.w - 4, (mr[0] + mr[2]) * this.w + pad) - w, x));
      y = Math.max(Math.max(4, mr[1] * this.h - pad), Math.min(Math.min(this.h - 4, (mr[1] + mr[3]) * this.h + pad) - h, y));
      if (this._overlap(x, y, w, h) > 0.2) continue;
      var cover = this.maskAt(x + w / 2, y + h / 2);
      if (!best || cover > best.cover) best = { x: x, y: y, w: w, h: h, cover: cover };
      if (cover > 0.3) break;
    }
    this.lastSpawn = t;
    if (!best) return; // every spot overlapped a live box; try again next interval

    // Over the limit: the oldest boxes start fading now instead of popping out.
    var alive = this.boxes.filter(function (b) { return t - b.born < b.fadeAt; });
    alive.sort(function (a, b) { return a.born - b.born; });
    for (var i = 0; i <= alive.length - p.maxBoxes; i++) alive[i].fadeAt = Math.max(p.boxFadeIn, t - alive[i].born);

    var box = {
      id: this.nextId++, x: best.x, y: best.y, w: best.w, h: best.h,
      born: t, fadeAt: p.boxFadeIn + p.boxLife * (0.7 + R() * 0.6), a: 0,
      conf: (0.62 + R() * 0.37).toFixed(2)
    };

    if (R() < p.linkChance) {
      var near = null, nd = p.linkMaxDist;
      for (var j = 0; j < this.boxes.length; j++) {
        var o = this.boxes[j];
        if (t - o.born >= o.fadeAt) continue;
        var d = Math.hypot(o.x + o.w / 2 - (box.x + box.w / 2), o.y + o.h / 2 - (box.y + box.h / 2));
        if (d < nd) { nd = d; near = o; }
      }
      if (near) this.links.push({ a: near, b: box });
    }
    this.boxes.push(box);
    this.travel = 0;
  };

  // Largest share of the candidate's area covered by a live box (or vice versa).
  Card.prototype._overlap = function (x, y, w, h) {
    var worst = 0;
    for (var i = 0; i < this.boxes.length; i++) {
      var b = this.boxes[i];
      var ix = Math.max(0, Math.min(x + w, b.x + b.w) - Math.max(x, b.x));
      var iy = Math.max(0, Math.min(y + h, b.y + b.h) - Math.max(y, b.y));
      worst = Math.max(worst, ix * iy / Math.min(w * h, b.w * b.h));
    }
    return worst;
  };

  // Strength of each influence point, for the shader.
  Card.prototype._points = function () {
    var p = this.p, t = this.t, n = 0, a = this.pts;
    function add(x, y, s) {
      if (s < 0.004 || n >= MAX_PTS) return;
      a[n * 3] = x; a[n * 3 + 1] = y; a[n * 3 + 2] = s; n++;
    }
    add(this.sm.x, this.sm.y, this.hover);
    for (var i = this.trail.length - 1; i >= 0; i--) {
      var q = this.trail[i];
      add(q.x, q.y, p.trailStrength * Math.exp(-(t - q.t0) / Math.max(0.01, p.trailDecay)));
    }
    for (var j = 0; j < this.pulses.length; j++) {
      var u = this.pulses[j], age = t - u.t0;
      add(u.x, u.y, Math.min(1, age / 0.08) * Math.exp(-age / 0.35));
    }
    return n;
  };

  // ---------------------------------------------------------------- render

  Card.prototype.render = function () {
    if (!this.w || !this.maskRect) return;
    this.frames++;
    this._renderGl();
    this._renderBoxes();
  };

  Card.prototype._renderGl = function () {
    var gl = this.gl, p = this.p, u = this.u;
    if (!gl) return;
    var n = this._points();
    // Reduced motion: the pattern holds still; only the pointer brightening remains.
    var time = this.reduced ? 0 : this.t;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform1f(u.uTime, time);
    gl.uniform4fv(u.uMaskRect, this.maskRect);
    gl.uniform1f(u.uPitch, p.pitch);
    gl.uniform1f(u.uWidth, p.lineWidth);
    gl.uniform1f(u.uBase, p.base);
    gl.uniform1f(u.uOutside, p.outside);
    gl.uniform1f(u.uContrast, p.contrast);
    gl.uniform1f(u.uNoise, p.noise);
    gl.uniform1f(u.uNoiseSpeed, p.noiseSpeed);
    gl.uniform1f(u.uFlow, p.flow);
    gl.uniform1f(u.uRain, p.rain);
    gl.uniform1f(u.uRainSpeed, p.rainSpeed);
    gl.uniform1f(u.uRainLen, p.rainLength);
    gl.uniform1f(u.uRainOut, p.rainOutside);
    gl.uniform1f(u.uRadius, p.radius);
    gl.uniform1f(u.uBoost, p.boost);
    gl.uniform1f(u.uJitter, this.reduced ? 0 : p.jitter);
    gl.uniform1f(u.uSparkle, this.reduced ? 0 : p.sparkle);
    gl.uniform1f(u.uSweep, this.sweepStart === null ? -1 : (this.t - this.sweepStart) / p.sweepDuration);
    gl.uniform3fv(u.uColor, hexToRgb(this.theme.line));
    gl.uniform3fv(u.uPts, this.pts);
    gl.uniform1i(u.uCount, n);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  function label(b, mode) {
    var id = '#' + (b.id < 10 ? '0' : '') + b.id;
    if (mode === 'id') return id;
    if (mode === 'both') return id + ' ' + b.conf;
    if (mode === 'conf') return b.conf;
    return '';
  }

  function corner(b, x, y) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return [x < cx ? b.x : b.x + b.w, y < cy ? b.y : b.y + b.h];
  }

  Card.prototype._renderBoxes = function () {
    var color = this.theme.box, i;
    this.svg.style.color = color;
    for (i = 0; i < this.boxes.length; i++) {
      var b = this.boxes[i], node = this._boxNode(i);
      var L = Math.min(7, b.w * 0.25, b.h * 0.25);
      var x0 = b.x + 0.5, y0 = b.y + 0.5, x1 = b.x + b.w - 0.5, y1 = b.y + b.h - 0.5;
      node.g.style.display = '';
      node.g.style.opacity = b.a.toFixed(3);
      node.r.setAttribute('x', x0); node.r.setAttribute('y', y0);
      node.r.setAttribute('width', b.w - 1); node.r.setAttribute('height', b.h - 1);
      node.c.setAttribute('d',
        'M' + x0 + ' ' + (y0 + L) + 'V' + y0 + 'H' + (x0 + L) +
        'M' + (x1 - L) + ' ' + y0 + 'H' + x1 + 'V' + (y0 + L) +
        'M' + x1 + ' ' + (y1 - L) + 'V' + y1 + 'H' + (x1 - L) +
        'M' + (x0 + L) + ' ' + y1 + 'H' + x0 + 'V' + (y1 - L));
      var text = label(b, this.p.labels);
      node.t.textContent = text;
      node.t.setAttribute('x', b.x);
      node.t.setAttribute('y', b.y > 14 ? b.y - 4 : b.y + b.h + 11);
    }
    for (; i < this.boxNodes.length; i++) this.boxNodes[i].g.style.display = 'none';

    for (i = 0; i < this.links.length; i++) {
      var l = this.links[i], ln = this._linkNode(i);
      var bc = [l.b.x + l.b.w / 2, l.b.y + l.b.h / 2], ac = [l.a.x + l.a.w / 2, l.a.y + l.a.h / 2];
      var pa = corner(l.a, bc[0], bc[1]), pb = corner(l.b, ac[0], ac[1]);
      ln.style.display = '';
      ln.style.opacity = Math.min(l.a.a, l.b.a).toFixed(3);
      ln.setAttribute('x1', pa[0]); ln.setAttribute('y1', pa[1]);
      ln.setAttribute('x2', pb[0]); ln.setAttribute('y2', pb[1]);
    }
    for (; i < this.linkNodes.length; i++) this.linkNodes[i].style.display = 'none';
  };

  // ---------------------------------------------------------------- loop

  // Whether anything on the card is still changing.
  Card.prototype.busy = function () {
    if (this.sweepStart !== null) return true;
    if (!this.reduced && !this.coarse) return true; // idle flow on desktop
    if (this.ptr.inside || this.hover > 0.004 || this.boxes.length) return true;
    var t = this.t, p = this.p;
    if (this.trail.length && p.trailStrength * Math.exp(-(t - this.trail[this.trail.length - 1].t0) / p.trailDecay) > 0.004) return true;
    return this.pulses.length > 0;
  };

  Card.prototype._kick = function () {
    if (this.running || this.external || this.destroyed || !this.visible || document.hidden || !this.maskRect) return;
    this.running = true;
    this.last = null;
    var self = this;
    this.raf = requestAnimationFrame(function tick(ts) {
      if (self.external || self.destroyed || !self.visible || document.hidden) { self.running = false; return; }
      var dt = self.last === null ? 0 : Math.min(0.1, (ts - self.last) / 1000);
      self.last = ts;
      self.step(dt);
      self.render();
      if (self.busy()) self.raf = requestAnimationFrame(tick);
      else self.running = false;
    });
  };

  // Hand the clock to the caller (replay); release() gives it back.
  Card.prototype.hold = function () {
    this.external = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.running = false;
  };

  Card.prototype.release = function () {
    this.external = false;
    this._kick();
  };

  Card.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    var el = this.el, on = this._on;
    el.removeEventListener('pointerenter', on.enter);
    el.removeEventListener('pointermove', on.move);
    el.removeEventListener('pointerleave', on.leave);
    el.removeEventListener('pointerdown', on.down);
    document.removeEventListener('visibilitychange', on.visibility);
    if (this.ro) this.ro.disconnect();
    if (this.io) this.io.disconnect();
    var gl = this.gl;
    if (gl) {
      gl.deleteTexture(this.tex);
      gl.deleteBuffer(this.buf);
      gl.deleteProgram(this.prog);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
    this.art.remove();
  };

  global.VisionCard = {
    DEFAULTS: DEFAULTS,
    mount: function (el, opts) { return new Card(el, opts); }
  };
})(window);
