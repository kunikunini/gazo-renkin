export type OutputFormat = "image/jpeg" | "image/png" | "image/webp";

export type ProcessOptions = {
  width: number;
  height: number;
  quality: number;
  format: OutputFormat;
};

export type ImageDimensions = {
  width: number;
  height: number;
  source: Blob;
};

const MAX_EDGE = 16_384;
const MAX_PIXELS = 60_000_000;
const MAX_BACKGROUND_REMOVAL_PIXELS = 12_000_000;

export function isHeicFile(file: File) {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

export function isSupportedFile(file: File) {
  return (
    ["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    isHeicFile(file)
  );
}

async function normalizeSource(file: File): Promise<Blob> {
  if (!isHeicFile(file)) return file;

  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 1,
  });

  return Array.isArray(converted) ? converted[0] : converted;
}

async function decodeBitmap(source: Blob) {
  try {
    return await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(source);
  }
}

export async function getImageDimensions(file: File): Promise<ImageDimensions> {
  const source = await normalizeSource(file);
  const bitmap = await decodeBitmap(source);
  const dimensions = { width: bitmap.width, height: bitmap.height, source };
  bitmap.close();
  return dimensions;
}

export function validateTargetSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("幅と高さは1以上にしてください。");
  }
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    throw new Error("画像が大きすぎます。1辺16,384px・合計6,000万px以下にしてください。");
  }
}

export async function processImage(source: Blob, options: ProcessOptions) {
  validateTargetSize(options.width, options.height);
  const bitmap = await decodeBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(options.width);
  canvas.height = Math.round(options.height);

  const context = canvas.getContext("2d", { alpha: options.format === "image/png" });
  if (!context) {
    bitmap.close();
    throw new Error("画像処理を開始できませんでした。");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (options.format === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 1;
        canvas.height = 1;
        if (blob) resolve(blob);
        else reject(new Error("この形式への変換に失敗しました。"));
      },
      options.format,
      options.format === "image/png" ? undefined : options.quality,
    );
  });
}

export async function removeSolidBackground(source: Blob, sensitivity: number) {
  const bitmap = await decodeBitmap(source);
  const pixelCount = bitmap.width * bitmap.height;
  if (pixelCount > MAX_BACKGROUND_REMOVAL_PIXELS) {
    bitmap.close();
    throw new Error("背景透過は1,200万画素以下の画像に対応しています。先にサイズを小さくしてください。");
  }

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("背景透過を開始できませんでした。");
  }

  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const cornerIndexes = [
    0,
    canvas.width - 1,
    (canvas.height - 1) * canvas.width,
    pixelCount - 1,
  ];
  const background = cornerIndexes.reduce(
    (color, index) => {
      const offset = index * 4;
      color.red += pixels[offset];
      color.green += pixels[offset + 1];
      color.blue += pixels[offset + 2];
      return color;
    },
    { red: 0, green: 0, blue: 0 },
  );
  background.red /= cornerIndexes.length;
  background.green /= cornerIndexes.length;
  background.blue /= cornerIndexes.length;

  const threshold = 8 + Math.max(0, Math.min(100, sensitivity)) * 1.15;
  const thresholdSquared = threshold * threshold * 3;
  const visited = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const enqueueIfBackground = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    const offset = index * 4;
    const redDiff = pixels[offset] - background.red;
    const greenDiff = pixels[offset + 1] - background.green;
    const blueDiff = pixels[offset + 2] - background.blue;
    const distance = redDiff ** 2 + greenDiff ** 2 + blueDiff ** 2;
    if (distance <= thresholdSquared) queue[tail++] = index;
  };

  for (let x = 0; x < canvas.width; x += 1) {
    enqueueIfBackground(x);
    enqueueIfBackground((canvas.height - 1) * canvas.width + x);
  }
  for (let y = 1; y < canvas.height - 1; y += 1) {
    enqueueIfBackground(y * canvas.width);
    enqueueIfBackground(y * canvas.width + canvas.width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    pixels[index * 4 + 3] = 0;
    const x = index % canvas.width;
    const y = Math.floor(index / canvas.width);
    if (x > 0) enqueueIfBackground(index - 1);
    if (x < canvas.width - 1) enqueueIfBackground(index + 1);
    if (y > 0) enqueueIfBackground(index - canvas.width);
    if (y < canvas.height - 1) enqueueIfBackground(index + canvas.width);
  }

  context.putImageData(imageData, 0, 0);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 1;
      canvas.height = 1;
      if (blob) resolve(blob);
      else reject(new Error("背景透過画像の生成に失敗しました。"));
    }, "image/png");
  });
}

export function outputExtension(format: OutputFormat) {
  if (format === "image/jpeg") return "jpg";
  if (format === "image/webp") return "webp";
  return "png";
}

export function outputName(originalName: string, format: OutputFormat) {
  const base = originalName.replace(/\.[^.]+$/, "") || "image";
  return `${base}-renkin.${outputExtension(format)}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
