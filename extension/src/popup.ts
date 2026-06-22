import JSZip from "jszip";
import {
  formatBytes,
  getImageDimensions,
  isSupportedFile,
  outputName,
  processImage,
  type OutputFormat,
} from "../../src/lib/image-processing";

type ExtensionImage = {
  file: File;
  source: Blob;
  width: number;
  height: number;
};

const MAX_FILES = 25;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
let images: ExtensionImage[] = [];

function element<T extends HTMLElement>(id: string) {
  const target = document.getElementById(id);
  if (!target) throw new Error(`Missing element: ${id}`);
  return target as T;
}

const fileInput = element<HTMLInputElement>("images");
const widthInput = element<HTMLInputElement>("width");
const heightInput = element<HTMLInputElement>("height");
const keepRatioInput = element<HTMLInputElement>("keep-ratio");
const formatInput = element<HTMLSelectElement>("format");
const qualityInput = element<HTMLInputElement>("quality");
const qualityValue = element<HTMLOutputElement>("quality-value");
const forgeButton = element<HTMLButtonElement>("forge");
const summary = element<HTMLDivElement>("file-summary");
const status = element<HTMLDivElement>("status");
const progress = element<HTMLDivElement>("progress-bar");
const progressRoot = progress.parentElement;

function setProgress(value: number) {
  const safeValue = Math.max(0, Math.min(100, value));
  progress.style.width = `${safeValue}%`;
  progressRoot?.setAttribute("aria-valuenow", String(safeValue));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

fileInput.addEventListener("change", async () => {
  const selected = Array.from(fileInput.files ?? []).slice(0, MAX_FILES);
  images = [];
  forgeButton.disabled = true;
  setProgress(0);
  status.textContent = "▶ 画像のステータスを しらべています…";
  const rejected: string[] = [];

  for (const file of selected) {
    if (!isSupportedFile(file) || file.size > MAX_FILE_SIZE) {
      rejected.push(file.name);
      continue;
    }
    try {
      const decoded = await getImageDimensions(file);
      images.push({ file, source: decoded.source, width: decoded.width, height: decoded.height });
    } catch {
      rejected.push(file.name);
    }
  }

  if (images[0]) {
    widthInput.value = String(images[0].width);
    heightInput.value = String(images[0].height);
  }
  const totalBytes = images.reduce((total, image) => total + image.file.size, 0);
  summary.textContent = images.length
    ? `${images.length}枚 ／ ${formatBytes(totalBytes)}${rejected.length ? ` ／ 読込失敗：${rejected.length}枚` : ""}`
    : "対応画像を 読み込めませんでした。";
  status.textContent = images.length ? "▶ れんきんの準備が できました！" : "▶ 別の画像を えらんでください。";
  forgeButton.disabled = images.length === 0;
});

widthInput.addEventListener("input", () => {
  if (!keepRatioInput.checked || !images[0]) return;
  const width = Math.max(1, Number(widthInput.value));
  heightInput.value = String(Math.max(1, Math.round(width * images[0].height / images[0].width)));
});

heightInput.addEventListener("input", () => {
  if (!keepRatioInput.checked || !images[0]) return;
  const height = Math.max(1, Number(heightInput.value));
  widthInput.value = String(Math.max(1, Math.round(height * images[0].width / images[0].height)));
});

keepRatioInput.addEventListener("change", () => {
  heightInput.disabled = keepRatioInput.checked;
  widthInput.dispatchEvent(new Event("input"));
});

qualityInput.addEventListener("input", () => {
  qualityValue.value = qualityInput.value;
});

formatInput.addEventListener("change", () => {
  qualityInput.disabled = formatInput.value === "image/png";
});

forgeButton.addEventListener("click", async () => {
  if (!images.length) return;
  forgeButton.disabled = true;
  const zip = new JSZip();
  const format = formatInput.value as OutputFormat;
  let successCount = 0;
  let outputBytes = 0;

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    status.textContent = `▶ れんきん中… ${index + 1} / ${images.length}`;
    try {
      const targetWidth = Math.max(1, Number(widthInput.value));
      const targetHeight = keepRatioInput.checked
        ? Math.max(1, Math.round(targetWidth * image.height / image.width))
        : Math.max(1, Number(heightInput.value));
      const result = await processImage(image.source, {
        width: targetWidth,
        height: targetHeight,
        quality: Number(qualityInput.value) / 100,
        format,
      });
      zip.file(outputName(image.file.name, format), result);
      outputBytes += result.size;
      successCount += 1;
    } catch {
      // 他の画像は継続し、最後に成功枚数を表示します。
    }
    setProgress(Math.round(((index + 1) / images.length) * 100));
  }

  if (successCount) {
    const archive = await zip.generateAsync({ type: "blob" });
    downloadBlob(archive, "gazo-renkin.zip");
    status.textContent = `▶ 完了！ ${successCount}枚 ／ 出力 ${formatBytes(outputBytes)}`;
  } else {
    status.textContent = "▶ れんきんに失敗しました。設定を確認してください。";
  }
  forgeButton.disabled = false;
});
