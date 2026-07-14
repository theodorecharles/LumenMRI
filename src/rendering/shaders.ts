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
  uniform vec3 uSize;
  uniform vec3 uColorLow;
  uniform vec3 uColorMid;
  uniform vec3 uColorHigh;
  uniform float uThreshold;
  uniform float uOpacity;
  uniform float uWindow;
  uniform float uLevel;
  uniform float uSteps;
  uniform float uClip;
  uniform vec4 uCrop;

  float sampleVolume(vec3 uvw) {
    vec3 voxel = clamp(uvw, vec3(0.0), vec3(1.0)) * (uDimensions - vec3(1.0));
    ivec2 inPlane = ivec2(round(voxel.xy));
    int lowerSlice = int(floor(voxel.z));
    int upperSlice = min(lowerSlice + 1, int(uDimensions.z) - 1);
    float betweenSlices = smoothstep(0.0, 1.0, fract(voxel.z));
    float lowerValue = texelFetch(uData, ivec3(inPlane, lowerSlice), 0).r;
    float upperValue = texelFetch(uData, ivec3(inPlane, upperSlice), 0).r;
    return mix(lowerValue, upperValue, betweenSlices);
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
      vec3 position = vOrigin + rayDirection * (bounds.x + (float(index) + 0.5) * stepLength);
      vec3 uvw = position / uSize + 0.5;
      if (uvw.z > uClip) continue;
      if (uvw.x < uCrop.x || uvw.x > uCrop.y || uvw.y < uCrop.z || uvw.y > uCrop.w) continue;

      float rawValue = sampleVolume(uvw);
      float windowLow = uLevel - uWindow * 0.5;
      float value = clamp((rawValue - windowLow) / max(0.015, uWindow), 0.0, 1.0);
      float structure = smoothstep(uThreshold, min(1.0, uThreshold + 0.16), value);

      if (structure > 0.001) {
        vec3 voxel = 1.0 / uDimensions;
        vec3 gradient = vec3(
          sampleVolume(uvw + vec3(voxel.x, 0.0, 0.0)) - sampleVolume(uvw - vec3(voxel.x, 0.0, 0.0)),
          sampleVolume(uvw + vec3(0.0, voxel.y, 0.0)) - sampleVolume(uvw - vec3(0.0, voxel.y, 0.0)),
          sampleVolume(uvw + vec3(0.0, 0.0, voxel.z)) - sampleVolume(uvw - vec3(0.0, 0.0, voxel.z))
        );
        vec3 normal = normalize(gradient + vec3(0.0001));
        float light = 0.58 + 0.42 * abs(dot(normal, -rayDirection));
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
