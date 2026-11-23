// WebGL state answered from memory (the browser build). Dear ImGui's OpenGL
// backend saves and restores a dozen pieces of GL state around every draw
// (glGetIntegerv: viewport, scissor, blend, bindings, program), and a WebGL
// getParameter can be slow: on a Samsung S22 in Chrome each one took about
// 0.3 ms, 4.5 ms of every frame, enough to drop SameBoy to ~51 fps.
//
// Here the setters remember what they set, per context, and getParameter
// answers those from memory; anything not seen yet (or not tracked) asks
// the browser once and is remembered from then on, so this can start at any
// moment, even with a context already in use. Assumes the GL calls succeed
// (piccolo's do; a failing setter would leave the real state unchanged).

'use strict';

(function () {
  const proto = typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null;
  if (proto === null || proto.piccoloGlState) {
    return;
  }
  proto.piccoloGlState = true;
  const GL = WebGL2RenderingContext;
  const states = new WeakMap();

  function state(gl) {
    let s = states.get(gl);
    if (s === undefined) {
      s = { values: new Map(), unit: null, textures: new Map(), samplers: new Map() };
      states.set(gl, s);
    }
    return s;
  }

  const original = {};
  for (const name of ['getParameter', 'viewport', 'scissor', 'blendFunc', 'blendFuncSeparate', 'blendEquation',
                      'blendEquationSeparate', 'activeTexture', 'bindTexture', 'bindSampler', 'bindVertexArray',
                      'bindBuffer', 'useProgram', 'deleteTexture', 'deleteSampler', 'deleteVertexArray',
                      'deleteBuffer']) {
    original[name] = proto[name];
  }

  // The active unit (ACTIVE_TEXTURE), asked once.
  function unit(gl, s) {
    if (s.unit === null) {
      s.unit = original.getParameter.call(gl, GL.ACTIVE_TEXTURE);
    }
    return s.unit;
  }

  proto.getParameter = function (pname) {
    const s = state(this);
    switch (pname) {
      case GL.ACTIVE_TEXTURE:
        return unit(this, s);
      case GL.TEXTURE_BINDING_2D: {
        const u = unit(this, s);
        if (!s.textures.has(u)) {
          s.textures.set(u, original.getParameter.call(this, pname));
        }
        return s.textures.get(u);
      }
      case GL.SAMPLER_BINDING: {
        const u = unit(this, s);
        if (!s.samplers.has(u)) {
          s.samplers.set(u, original.getParameter.call(this, pname));
        }
        return s.samplers.get(u);
      }
      case GL.VIEWPORT:
      case GL.SCISSOR_BOX: {
        if (!s.values.has(pname)) {
          s.values.set(pname, original.getParameter.call(this, pname));
        }
        return new Int32Array(s.values.get(pname));   // (a copy, as the browser gives)
      }
      case GL.BLEND_SRC_RGB:
      case GL.BLEND_DST_RGB:
      case GL.BLEND_SRC_ALPHA:
      case GL.BLEND_DST_ALPHA:
      case GL.BLEND_EQUATION_RGB:
      case GL.BLEND_EQUATION_ALPHA:
      case GL.VERTEX_ARRAY_BINDING:
      case GL.ARRAY_BUFFER_BINDING:
      case GL.CURRENT_PROGRAM:
        if (!s.values.has(pname)) {
          s.values.set(pname, original.getParameter.call(this, pname));
        }
        return s.values.get(pname);
      default:
        return original.getParameter.call(this, pname);
    }
  };

  proto.viewport = function (x, y, width, height) {
    original.viewport.call(this, x, y, width, height);
    state(this).values.set(GL.VIEWPORT, new Int32Array([x, y, width, height]));
  };
  proto.scissor = function (x, y, width, height) {
    original.scissor.call(this, x, y, width, height);
    state(this).values.set(GL.SCISSOR_BOX, new Int32Array([x, y, width, height]));
  };
  proto.blendFunc = function (src, dst) {
    original.blendFunc.call(this, src, dst);
    const v = state(this).values;
    v.set(GL.BLEND_SRC_RGB, src); v.set(GL.BLEND_SRC_ALPHA, src);
    v.set(GL.BLEND_DST_RGB, dst); v.set(GL.BLEND_DST_ALPHA, dst);
  };
  proto.blendFuncSeparate = function (srcRgb, dstRgb, srcAlpha, dstAlpha) {
    original.blendFuncSeparate.call(this, srcRgb, dstRgb, srcAlpha, dstAlpha);
    const v = state(this).values;
    v.set(GL.BLEND_SRC_RGB, srcRgb); v.set(GL.BLEND_DST_RGB, dstRgb);
    v.set(GL.BLEND_SRC_ALPHA, srcAlpha); v.set(GL.BLEND_DST_ALPHA, dstAlpha);
  };
  proto.blendEquation = function (mode) {
    original.blendEquation.call(this, mode);
    const v = state(this).values;
    v.set(GL.BLEND_EQUATION_RGB, mode); v.set(GL.BLEND_EQUATION_ALPHA, mode);
  };
  proto.blendEquationSeparate = function (rgb, alpha) {
    original.blendEquationSeparate.call(this, rgb, alpha);
    const v = state(this).values;
    v.set(GL.BLEND_EQUATION_RGB, rgb); v.set(GL.BLEND_EQUATION_ALPHA, alpha);
  };
  proto.activeTexture = function (texture) {
    original.activeTexture.call(this, texture);
    state(this).unit = texture;
  };
  proto.bindTexture = function (target, texture) {
    original.bindTexture.call(this, target, texture);
    if (target === GL.TEXTURE_2D) {
      const s = state(this);
      s.textures.set(unit(this, s), texture);
    }
  };
  proto.bindSampler = function (u, sampler) {
    original.bindSampler.call(this, u, sampler);
    state(this).samplers.set(GL.TEXTURE0 + u, sampler);
  };
  proto.bindVertexArray = function (array) {
    original.bindVertexArray.call(this, array);
    state(this).values.set(GL.VERTEX_ARRAY_BINDING, array);
  };
  proto.bindBuffer = function (target, buffer) {
    original.bindBuffer.call(this, target, buffer);
    if (target === GL.ARRAY_BUFFER) {
      state(this).values.set(GL.ARRAY_BUFFER_BINDING, buffer);
    }
  };
  proto.useProgram = function (program) {
    original.useProgram.call(this, program);
    state(this).values.set(GL.CURRENT_PROGRAM, program);
  };

  // A deleted object stops being bound (a deleted program stays current, as in GL).
  proto.deleteTexture = function (texture) {
    original.deleteTexture.call(this, texture);
    const s = state(this);
    for (const [u, bound] of s.textures) {
      if (bound === texture) s.textures.set(u, null);
    }
  };
  proto.deleteSampler = function (sampler) {
    original.deleteSampler.call(this, sampler);
    const s = state(this);
    for (const [u, bound] of s.samplers) {
      if (bound === sampler) s.samplers.set(u, null);
    }
  };
  proto.deleteVertexArray = function (array) {
    original.deleteVertexArray.call(this, array);
    const v = state(this).values;
    if (v.get(GL.VERTEX_ARRAY_BINDING) === array) v.set(GL.VERTEX_ARRAY_BINDING, null);
  };
  proto.deleteBuffer = function (buffer) {
    original.deleteBuffer.call(this, buffer);
    const v = state(this).values;
    if (v.get(GL.ARRAY_BUFFER_BINDING) === buffer) v.set(GL.ARRAY_BUFFER_BINDING, null);
  };
})();
