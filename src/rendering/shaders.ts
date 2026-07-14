export const volumeVertexShader = /* glsl */ `
  out vec3 vOrigin;
  out vec3 vDirection;

  void main() {
    vec4 worldOrigin = inverse(modelMatrix) * vec4(cameraPosition, 1.0);
    vOrigin = worldOrigin.xyz;
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const volumeFragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  in vec3 vOrigin;
  in vec3 vDirection;
  out vec4 outColor;

  uniform sampler3D uData;
  uniform vec3 uDimensions;
  uniform float uReconstructed;
  uniform vec3 uSize;
  uniform vec3 uColorLow;
  uniform vec3 uColorMid;
  uniform vec3 uColorHigh;
  uniform float uThreshold;
  uniform float uOpacity;
  uniform float uWindow;
  uniform float uLevel;
  uniform float uSteps;
  uniform float uShading;
  uniform float uSharpness;
  uniform vec3 uCropMin;
  uniform vec3 uCropMax;

  float monotonicSlope(float before, float after) {
    if (before * after <= 0.0) return 0.0;
    return (2.0 * before * after) / (before + after);
  }

  float interpolateSlices(float value0, float value1, float value2, float value3, float t) {
    float delta0 = value1 - value0;
    float delta1 = value2 - value1;
    float delta2 = value3 - value2;
    float tangent1 = monotonicSlope(delta0, delta1);
    float tangent2 = monotonicSlope(delta1, delta2);
    float t2 = t * t;
    float t3 = t2 * t;
    float interpolated =
      (2.0 * t3 - 3.0 * t2 + 1.0) * value1 +
      (t3 - 2.0 * t2 + t) * tangent1 +
      (-2.0 * t3 + 3.0 * t2) * value2 +
      (t3 - t2) * tangent2;
    return clamp(interpolated, min(value1, value2), max(value1, value2));
  }

  float sampleVolume(vec3 uvw) {
    vec3 orientedUVW = vec3(uvw.x, 1.0 - uvw.y, uvw.z);
    vec3 voxel = clamp(orientedUVW, vec3(0.0), vec3(1.0)) * (uDimensions - vec3(1.0));
    ivec2 inPlane = ivec2(round(voxel.xy));
    int sliceCount = int(uDimensions.z);
    int slice1 = int(floor(voxel.z));
    int slice0 = max(0, slice1 - 1);
    int slice2 = min(sliceCount - 1, slice1 + 1);
    int slice3 = min(sliceCount - 1, slice1 + 2);
    float t = fract(voxel.z);
    float value1 = texelFetch(uData, ivec3(inPlane, slice1), 0).r;
    float value2 = texelFetch(uData, ivec3(inPlane, slice2), 0).r;
    if (uReconstructed > 0.5) {
      return mix(value1, value2, smoothstep(0.0, 1.0, t));
    }
    float value0 = texelFetch(uData, ivec3(inPlane, slice0), 0).r;
    float value3 = texelFetch(uData, ivec3(inPlane, slice3), 0).r;
    return interpolateSlices(value0, value1, value2, value3, t);
  }

  vec2 hitBox(vec3 origin, vec3 direction) {
    vec3 inverseDirection = 1.0 / direction;
    vec3 halfSize = uSize * 0.5;
    vec3 tMin = (-halfSize - origin) * inverseDirection;
    vec3 tMax = (halfSize - origin) * inverseDirection;
    vec3 tNear = min(tMin, tMax);
    vec3 tFar = max(tMin, tMax);
    return vec2(max(max(tNear.x, tNear.y), tNear.z), min(min(tFar.x, tFar.y), tFar.z));
  }

  vec3 palette(float value) {
    if (value < 0.55) return mix(uColorLow, uColorMid, smoothstep(0.0, 0.55, value));
    return mix(uColorMid, uColorHigh, smoothstep(0.55, 1.0, value));
  }

  void main() {
    vec3 rayDirection = normalize(vDirection);
    vec2 bounds = hitBox(vOrigin, rayDirection);
    if (bounds.x > bounds.y) discard;
    bounds.x = max(bounds.x, 0.0);

    float distanceThroughVolume = bounds.y - bounds.x;
    float stepLength = distanceThroughVolume / max(1.0, uSteps);
    vec4 accumulated = vec4(0.0);

    for (int index = 0; index < 512; index++) {
      if (float(index) >= uSteps || accumulated.a > 0.975) break;
      float rayJitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
      vec3 position = vOrigin + rayDirection * (bounds.x + (float(index) + rayJitter) * stepLength);
      vec3 uvw = position / uSize + 0.5;
      if (any(lessThan(uvw, uCropMin)) || any(greaterThan(uvw, uCropMax))) continue;

      float rawValue = sampleVolume(uvw);
      float windowLow = uLevel - uWindow * 0.5;
      float value = clamp((rawValue - windowLow) / max(0.015, uWindow), 0.0, 1.0);
      float structure = smoothstep(uThreshold, min(1.0, uThreshold + 0.16), value);

      if (structure > 0.001) {
        vec3 voxel = 1.0 / uDimensions;
        vec3 gradient = vec3(
          sampleVolume(uvw + vec3(voxel.x, 0.0, 0.0)) - rawValue,
          sampleVolume(uvw + vec3(0.0, voxel.y, 0.0)) - rawValue,
          sampleVolume(uvw + vec3(0.0, 0.0, voxel.z)) - rawValue
        );
        float edgeBoost = clamp(length(gradient) * uSharpness * 1.5, 0.0, 0.24);
        value = clamp(value + edgeBoost, 0.0, 1.0);
        structure = smoothstep(uThreshold, min(1.0, uThreshold + 0.16), value);
        vec3 normal = normalize(gradient + vec3(0.0001));
        float light = mix(1.0, 0.58 + 0.42 * abs(dot(normal, -rayDirection)), uShading);
        float sampleAlpha = 1.0 - exp(-structure * uOpacity * stepLength * 14.0);
        vec3 sampleColor = palette(value) * light;
        accumulated.rgb += (1.0 - accumulated.a) * sampleColor * sampleAlpha;
        accumulated.a += (1.0 - accumulated.a) * sampleAlpha;
      }
    }

    if (accumulated.a < 0.004) discard;
    outColor = accumulated;
  }
`
