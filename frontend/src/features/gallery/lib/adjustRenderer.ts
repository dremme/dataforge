import { COLOR_DETAIL } from "@/shared/constants";

export type TextureSource = TexImageSource;

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/** `frame` is the whole source at output scale: the canvas shows all of it, crop or not. */
export function canZoom(canvas: Size, frame: Size): boolean {
  return frame.width > canvas.width || frame.height > canvas.height;
}

export function zoomView(origin: { x: number; y: number }, canvas: Size, frame: Size): FrameRect {
  const width = Math.min(1, canvas.width / Math.max(1, frame.width));
  const height = Math.min(1, canvas.height / Math.max(1, frame.height));
  return { x: (1 - width) * origin.x, y: (1 - height) * origin.y, width, height };
}

export interface DetailSettings {
  noiseReduction: number;
  definition: number;
}

export interface RenderRequest {
  view: FrameRect;
  crop: FrameRect;
  outputScale: number;
  outputSize: Size;
  detail: DetailSettings;
  original: boolean;
}

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const YCC = `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 toYcc(vec3 rgb) {
  float y = dot(LUMA, rgb);
  return vec3(y, (rgb.b - y) / 1.8556 + 0.5, (rgb.r - y) / 1.5748 + 0.5);
}
vec3 toRgb(vec3 ycc) {
  float r = ycc.x + 1.5748 * (ycc.z - 0.5);
  float b = ycc.x + 1.8556 * (ycc.y - 0.5);
  float g = (ycc.x - 0.2126 * r - 0.0722 * b) / 0.7152;
  return vec3(r, g, b);
}`;

const VIEW = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec4 u_view;
uniform vec2 u_size;
out vec4 color;
${YCC}
void main() {
  vec2 uv = u_view.xy + gl_FragCoord.xy / u_size * u_view.zw;
  vec4 pixel = texture(u_source, uv);
  color = vec4(toYcc(pixel.rgb), pixel.a);
}`;

const BASE = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec4 u_crop;
uniform vec2 u_size;
out vec4 color;
${YCC}
void main() {
  vec2 uv = u_crop.xy + gl_FragCoord.xy / u_size * u_crop.zw;
  color = vec4(toYcc(texture(u_source, uv).rgb).x, 0.0, 0.0, 1.0);
}`;

const GAUSS = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform ivec2 u_direction;
uniform float u_sigma;
out vec4 color;
void main() {
  ivec2 size = textureSize(u_input, 0);
  ivec2 at = ivec2(gl_FragCoord.xy);
  int reach = int(ceil(3.0 * u_sigma));
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -reach; i <= reach; i++) {
    float weight = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    ivec2 tap = clamp(at + u_direction * i, ivec2(0), size - 1);
    sum += weight * texelFetch(u_input, tap, 0);
    total += weight;
  }
  color = sum / total;
}`;

const MOMENTS = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform bool u_squares;
out vec4 color;
void main() {
  vec3 ycc = texelFetch(u_input, ivec2(gl_FragCoord.xy), 0).xyz;
  color = u_squares ? vec4(ycc.yz * ycc.yz, 0.0, 0.0) : vec4(ycc, ycc.x * ycc.x);
}`;

// Replicate border and a square window: the box ffmpeg's guided and cv2.boxFilter both take.
const BOX = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform ivec2 u_direction;
uniform ivec4 u_radii;
out vec4 color;
void main() {
  ivec2 size = textureSize(u_input, 0);
  ivec2 at = ivec2(gl_FragCoord.xy);
  int reach = max(max(u_radii.x, u_radii.y), max(u_radii.z, u_radii.w));
  vec4 sum = vec4(0.0);
  for (int i = -reach; i <= reach; i++) {
    vec4 tap = texelFetch(u_input, clamp(at + u_direction * i, ivec2(0), size - 1), 0);
    ivec4 inside = ivec4(lessThanEqual(ivec4(abs(i)), u_radii));
    sum += tap * vec4(inside);
  }
  color = sum / vec4(2 * u_radii + 1);
}`;

const COEFFICIENTS = `#version 300 es
precision highp float;
uniform sampler2D u_means;
uniform sampler2D u_squares;
uniform vec2 u_eps;
uniform bool u_offsets;
out vec4 color;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec4 means = texelFetch(u_means, at, 0);
  vec2 chromaSquares = texelFetch(u_squares, at, 0).xy;
  vec3 variance = max(vec3(means.w, chromaSquares) - means.xyz * means.xyz, 0.0);
  vec3 a = variance / (variance + vec3(u_eps.x, u_eps.y, u_eps.y));
  color = u_offsets ? vec4(means.xyz - a * means.xyz, 0.0) : vec4(a, 0.0);
}`;

const APPLY = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform sampler2D u_a;
uniform sampler2D u_b;
out vec4 color;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec4 pixel = texelFetch(u_input, at, 0);
  vec3 a = texelFetch(u_a, at, 0).xyz;
  vec3 b = texelFetch(u_b, at, 0).xyz;
  color = vec4(a * pixel.xyz + b, pixel.a);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D u_picture;
uniform sampler2D u_base;
uniform highp sampler3D u_lut;
uniform bool u_useBase;
uniform bool u_useLut;
uniform float u_lutSize;
uniform vec4 u_view;
uniform vec4 u_crop;
uniform vec2 u_size;
uniform vec2 u_definition;
out vec4 color;
${YCC}
void main() {
  // The canvas counts rows from the bottom; every texture here counts them from the top.
  vec2 frag = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  vec4 pixel = texelFetch(u_picture, ivec2(frag), 0);
  vec3 ycc = pixel.xyz;
  if (u_useBase) {
    vec2 uv = u_view.xy + frag / u_size * u_view.zw;
    float base = texture(u_base, (uv - u_crop.xy) / u_crop.zw).x;
    float detail = ycc.x - base;
    float limited = detail / (1.0 + abs(detail) / u_definition.y);
    ycc.x = clamp(ycc.x + u_definition.x * limited * 4.0 * ycc.x * (1.0 - ycc.x), 0.0, 1.0);
  }
  vec3 rgb = clamp(toRgb(ycc), 0.0, 1.0);
  if (u_useLut) {
    vec3 cell = rgb * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
    rgb = texture(u_lut, cell).rgb;
  }
  color = vec4(rgb, pixel.a);
}`;

type ProgramName =
  "view" | "base" | "gauss" | "moments" | "box" | "coefficients" | "apply" | "composite";

const FRAGMENTS: Record<ProgramName, string> = {
  view: VIEW,
  base: BASE,
  gauss: GAUSS,
  moments: MOMENTS,
  box: BOX,
  coefficients: COEFFICIENTS,
  apply: APPLY,
  composite: COMPOSITE,
};

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

type UniformValue =
  number | boolean | readonly number[] | { texture: WebGLTexture; is3d?: boolean };

export function viewRadius(
  outputRadius: number,
  canvasWidth: number,
  request: RenderRequest,
  sourceWidth: number,
): number {
  const sourcePixels = request.view.width * sourceWidth;
  const outputPixels = sourcePixels * request.outputScale;
  if (outputPixels <= 0) return 0;
  return Math.round((outputRadius * canvasWidth) / outputPixels);
}

export function definitionBase(outputSize: Size): {
  width: number;
  height: number;
  sigma: number;
} {
  const shortSide = COLOR_DETAIL.definition_short_side;
  const factor = Math.min(1, shortSide / Math.min(outputSize.width, outputSize.height));
  const width = Math.max(1, Math.round(outputSize.width * factor));
  const height = Math.max(1, Math.round(outputSize.height * factor));
  return {
    width,
    height,
    sigma: (COLOR_DETAIL.definition_sigma * Math.min(width, height)) / shortSide,
  };
}

export class AdjustRenderer {
  readonly floatTargets: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly programs = new Map<ProgramName, WebGLProgram>();
  private readonly targets = new Map<string, Target>();
  private readonly vertexArray: WebGLVertexArrayObject | null;
  private source: WebGLTexture | null = null;
  private sourceSize = { width: 0, height: 0 };
  private lut: WebGLTexture | null = null;
  private lutSize = 0;
  /** Bound when there is no LUT: a sampler3D must always see a 3D texture. */
  private readonly emptyLut: WebGLTexture | null;

  static create(canvas: HTMLCanvasElement): AdjustRenderer | null {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
    });
    if (!gl) return null;
    try {
      return new AdjustRenderer(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.floatTargets = gl.getExtension("EXT_color_buffer_float") !== null;
    this.vertexArray = gl.createVertexArray();
    this.emptyLut = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.emptyLut);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [name, fragment] of Object.entries(FRAGMENTS) as [ProgramName, string][]) {
      this.programs.set(name, this.link(fragment));
    }
  }

  get hasSource(): boolean {
    return this.source !== null;
  }

  setSource(source: TextureSource, width: number, height: number, mipmaps: boolean): void {
    const gl = this.gl;
    if (!this.source) this.source = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.sourceSize = { width, height };
  }

  /** RGBA floats, red fastest; `null` leaves the colors to the detail passes alone. */
  setLut(data: Float32Array | null, size: number): void {
    const gl = this.gl;
    if (!data) {
      this.lutSize = 0;
      return;
    }
    if (!this.lut) this.lut = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.lut);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, size, size, size, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      gl.texParameteri(gl.TEXTURE_3D, wrap, gl.CLAMP_TO_EDGE);
    }
    this.lutSize = size;
  }

  render(request: RenderRequest): void {
    const gl = this.gl;
    const { width, height } = gl.canvas;
    if (!this.source || width === 0 || height === 0) return;

    const view = [request.view.x, request.view.y, request.view.width, request.view.height];
    const crop = [request.crop.x, request.crop.y, request.crop.width, request.crop.height];
    const pictureFormat = this.floatTargets ? "float" : "byte";

    const picture = this.target(`picture-${pictureFormat}`, width, height, this.floatTargets);
    this.draw("view", picture, {
      u_source: { texture: this.source },
      u_view: view,
      u_size: [width, height],
    });

    let composed = picture;
    const detail = request.original ? { noiseReduction: 0, definition: 0 } : request.detail;
    if (detail.noiseReduction > 0 && this.floatTargets) {
      composed = this.reduceNoise(picture, detail.noiseReduction, request);
    }

    let base: Target | null = null;
    if (detail.definition > 0) {
      const size = definitionBase(request.outputSize);
      base = this.blurredBase(crop, size);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    this.use("composite", {
      u_picture: { texture: composed.texture },
      u_base: { texture: (base ?? composed).texture },
      u_lut: {
        texture: (this.lutSize > 0 ? this.lut : null) ?? (this.emptyLut as WebGLTexture),
        is3d: true,
      },
      u_useBase: base !== null,
      u_useLut: !request.original && this.lutSize > 0 && this.lut !== null,
      u_lutSize: this.lutSize,
      u_view: view,
      u_crop: crop,
      u_size: [width, height],
      u_definition: [
        COLOR_DETAIL.definition_gain * detail.definition,
        COLOR_DETAIL.definition_knee,
      ],
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    for (const target of this.targets.values()) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    this.targets.clear();
    for (const program of this.programs.values()) gl.deleteProgram(program);
    if (this.source) gl.deleteTexture(this.source);
    if (this.lut) gl.deleteTexture(this.lut);
    if (this.emptyLut) gl.deleteTexture(this.emptyLut);
    // Never loseContext(): StrictMode remounts on the same canvas and would get the dead context back.
    gl.deleteVertexArray(this.vertexArray);
  }

  private reduceNoise(picture: Target, strength: number, request: RenderRequest): Target {
    const { width, height } = picture;
    const luma = viewRadius(COLOR_DETAIL.noise_luma_radius, width, request, this.sourceSize.width);
    const chroma = viewRadius(
      COLOR_DETAIL.noise_chroma_radius,
      width,
      request,
      this.sourceSize.width,
    );
    if (luma < 1 && chroma < 1) return picture;

    const eps = [
      (COLOR_DETAIL.noise_luma_std * strength) ** 2,
      (COLOR_DETAIL.noise_chroma_std * strength) ** 2,
    ];
    const means = this.target("means", width, height, true);
    const squares = this.target("squares", width, height, true);
    this.draw("moments", means, { u_input: { texture: picture.texture }, u_squares: false });
    this.draw("moments", squares, { u_input: { texture: picture.texture }, u_squares: true });
    this.boxBlur(means, [luma, chroma, chroma, luma]);
    this.boxBlur(squares, [chroma, chroma, 0, 0]);

    const a = this.target("a", width, height, true);
    const b = this.target("b", width, height, true);
    const coefficients = {
      u_means: { texture: means.texture },
      u_squares: { texture: squares.texture },
      u_eps: eps,
    };
    this.draw("coefficients", a, { ...coefficients, u_offsets: false });
    this.draw("coefficients", b, { ...coefficients, u_offsets: true });
    const radii = [luma, chroma, chroma, 0];
    this.boxBlur(a, radii);
    this.boxBlur(b, radii);

    this.draw("apply", means, {
      u_input: { texture: picture.texture },
      u_a: { texture: a.texture },
      u_b: { texture: b.texture },
    });
    return means;
  }

  private boxBlur(target: Target, radii: number[]): void {
    const scratch = this.target("scratch", target.width, target.height, true);
    this.draw("box", scratch, {
      u_input: { texture: target.texture },
      u_direction: [1, 0],
      u_radii: radii,
    });
    this.draw("box", target, {
      u_input: { texture: scratch.texture },
      u_direction: [0, 1],
      u_radii: radii,
    });
  }

  private blurredBase(
    crop: number[],
    size: { width: number; height: number; sigma: number },
  ): Target {
    const base = this.target("base", size.width, size.height, false);
    const scratch = this.target("base-scratch", size.width, size.height, false);
    this.draw("base", base, {
      u_source: { texture: this.source as WebGLTexture },
      u_crop: crop,
      u_size: [size.width, size.height],
    });
    this.draw("gauss", scratch, {
      u_input: { texture: base.texture },
      u_direction: [1, 0],
      u_sigma: size.sigma,
    });
    this.draw("gauss", base, {
      u_input: { texture: scratch.texture },
      u_direction: [0, 1],
      u_sigma: size.sigma,
    });
    return base;
  }

  private target(name: string, width: number, height: number, float: boolean): Target {
    const gl = this.gl;
    const existing = this.targets.get(name);
    if (existing && existing.width === width && existing.height === height) return existing;
    if (existing) {
      gl.deleteTexture(existing.texture);
      gl.deleteFramebuffer(existing.framebuffer);
    }

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error("The GPU refused a render target");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const useFloat = float && this.floatTargets;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      useFloat ? gl.RGBA16F : gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const target = { texture, framebuffer, width, height };
    this.targets.set(name, target);
    return target;
  }

  private draw(name: ProgramName, target: Target, uniforms: Record<string, UniformValue>): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    this.use(name, uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private use(name: ProgramName, uniforms: Record<string, UniformValue>): void {
    const gl = this.gl;
    const program = this.programs.get(name);
    if (!program) return;
    gl.useProgram(program);
    gl.bindVertexArray(this.vertexArray);

    let unit = 0;
    for (const [key, value] of Object.entries(uniforms)) {
      const location = gl.getUniformLocation(program, key);
      if (location === null) continue;
      if (typeof value === "object" && "texture" in value) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(value.is3d ? gl.TEXTURE_3D : gl.TEXTURE_2D, value.texture);
        gl.uniform1i(location, unit);
        unit += 1;
      } else if (typeof value === "boolean") {
        gl.uniform1i(location, value ? 1 : 0);
      } else if (typeof value === "number") {
        gl.uniform1f(location, value);
      } else if (key === "u_direction") {
        gl.uniform2i(location, value[0], value[1]);
      } else if (key === "u_radii") {
        gl.uniform4i(location, value[0], value[1], value[2], value[3]);
      } else if (value.length === 2) {
        gl.uniform2f(location, value[0], value[1]);
      } else {
        gl.uniform4f(location, value[0], value[1], value[2], value[3]);
      }
    }
  }

  private link(fragment: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    const shaders = [
      this.compile(gl.VERTEX_SHADER, VERTEX),
      this.compile(gl.FRAGMENT_SHADER, fragment),
    ];
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "The preview shader did not link");
    }
    return program;
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("The GPU refused a shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "The preview shader did not compile");
    }
    return shader;
  }
}
