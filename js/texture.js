/**
 * 位图纹理：Image → texImage2D。
 * 地球等经纬贴图常见"上下颠倒"：WebGL 的 t=0 在图像底边，
 * 而图片文件第 0 行是北极。这里统一打开 UNPACK_FLIP_Y_WEBGL。
 */

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法加载纹理 " + url));
    img.src = url;
  });
}

export function createTexture(gl, image, flipY = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

export async function loadTextureMap(gl, entries) {
  const map = {};
  await Promise.all(
    entries.map(async ({ id, url }) => {
      const img = await loadImage(url);
      map[id] = createTexture(gl, img, true);
    }),
  );
  return map;
}
