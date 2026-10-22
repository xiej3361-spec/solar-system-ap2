/** VAO + VBO 封装，把 geometry.js 的结果上传到 GPU。 */

export function makeMesh(gl, geo) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  if (geo.normals) {
    const n = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, n);
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  }

  if (geo.uvs) {
    const t = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, t);
    gl.bufferData(gl.ARRAY_BUFFER, geo.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  }

  let ibo = null;
  if (geo.indices) {
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
  }

  gl.bindVertexArray(null);

  const mode =
    geo.mode === "lineLoop" ? gl.LINE_LOOP :
    geo.mode === "points" ? gl.POINTS :
    gl.TRIANGLES;

  return {
    draw() {
      gl.bindVertexArray(vao);
      if (ibo) gl.drawElements(mode, geo.count, gl.UNSIGNED_SHORT, 0);
      else gl.drawArrays(mode, 0, geo.count);
    },
  };
}

export function resizeCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
