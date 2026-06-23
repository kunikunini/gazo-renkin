import JSZip from "jszip";
import {
  formatBytes,
  getImageDimensions,
  isSupportedFile,
  outputName,
  processImage,
  removeSolidBackground,
  type OutputFormat,
} from "../../src/lib/image-processing";

// ── 定数 ─────────────────────────────────────────────────────────────────────
const HP_MAX = 1080;
const MP_MAX = 80;
const MP_COST_NORMAL = 2;
const MP_COST_POLPUNTE = 20;
const MAX_FILES = 25;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const HERO_NAME_KEY = "gazo-renkin:hero-name";
const LOG_MAX = 4;
const CRITICAL_EVERY = 3;

// ── 型 ───────────────────────────────────────────────────────────────────────
type ImageItem = {
  id: string;
  file: File;
  source: Blob;
  previewUrl: string;
  width: number;
  height: number;
  result?: Blob;
  resultUrl?: string;
  resultFormat?: OutputFormat;
  backgroundRemoved?: boolean;
};

// ── 状態 ─────────────────────────────────────────────────────────────────────
let items: ImageItem[] = [];
let pendingItems: ImageItem[] = [];
let stashedItems: ImageItem[] = [];
let currentHp = HP_MAX;
let currentMp = MP_MAX;
let saveCount = 0;
let attackCount = 0;
let heroName = "";
let selectedMagic: string | null = null;
let activeSubmenu: "magic" | "save" | "escape" | null = null;
let hokanteSelectedIds: string[] = [];
let messageLog: string[] = ["「たたかう」で れんきんしたい画像を えらぶのだ！"];

// ── DOM ヘルパー ──────────────────────────────────────────────────────────────
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing: #${id}`);
  return el as T;
}

// ── 要素取得 ──────────────────────────────────────────────────────────────────
const fileInput        = $<HTMLInputElement>("images");
const dqStatus         = $<HTMLDivElement>("dq-status");
const sName            = $<HTMLSpanElement>("s-name");
const sLv              = $<HTMLSpanElement>("s-lv");
const sHp              = $<HTMLSpanElement>("s-hp");
const sMp              = $<HTMLSpanElement>("s-mp");
const cmdNameEl        = $<HTMLParagraphElement>("cmd-name");
const dqEnemies        = $<HTMLDivElement>("dq-enemies");
const stagePending     = $<HTMLParagraphElement>("stage-pending");
const dqLog            = $<HTMLDivElement>("dq-log");
const cmdBattle        = $<HTMLButtonElement>("cmd-battle");
const cmdMagic         = $<HTMLButtonElement>("cmd-magic");
const cmdDefend        = $<HTMLButtonElement>("cmd-defend");
const cmdEscape        = $<HTMLButtonElement>("cmd-escape");
const submenuMagic     = $<HTMLDivElement>("submenu-magic");
const submenuSave      = $<HTMLDivElement>("submenu-save");
const submenuEscape    = $<HTMLDivElement>("submenu-escape");
const spellTricom      = $<HTMLButtonElement>("spell-tricom");
const spellResize      = $<HTMLButtonElement>("spell-resize");
const spellFormat      = $<HTMLButtonElement>("spell-format");
const spellTransparent = $<HTMLButtonElement>("spell-transparent");
const spellHokante     = $<HTMLButtonElement>("spell-hokante");
const spellPolpunte    = $<HTMLButtonElement>("spell-polpunte");
const saveZip          = $<HTMLButtonElement>("save-zip");
const saveAll          = $<HTMLButtonElement>("save-all");
const configResize     = $<HTMLDivElement>("config-resize");
const configFormat     = $<HTMLDivElement>("config-format");
const configTransparent = $<HTMLDivElement>("config-transparent");
const configHokante    = $<HTMLDivElement>("config-hokante");
const configPolpunte   = $<HTMLDivElement>("config-polpunte");
const processingOverlay = $<HTMLDivElement>("processing-overlay");
const processingMsg    = $<HTMLParagraphElement>("processing-msg");
const progressBar      = $<HTMLDivElement>("progress-bar");
const dupWarning       = $<HTMLDivElement>("dup-warning");
const dupFiles         = $<HTMLDivElement>("dup-files");
const widthInput       = $<HTMLInputElement>("width");
const heightInput      = $<HTMLInputElement>("height");
const keepRatioInput   = $<HTMLInputElement>("keep-ratio");
const formatSelect     = $<HTMLSelectElement>("format");
const qualityInput     = $<HTMLInputElement>("quality");
const qualityValue     = $<HTMLOutputElement>("quality-value");
const sensitivityInput = $<HTMLInputElement>("sensitivity");
const sensitivityLabel = $<HTMLElement>("sensitivity-label");
const hokantList       = $<HTMLDivElement>("hokante-list");
const doHokanteBtn     = $<HTMLButtonElement>("do-hokante");
const stashSection     = $<HTMLDivElement>("stash-section");
const stashList        = $<HTMLDivElement>("stash-list");
const revivalSection   = $<HTMLDivElement>("revival-section");
const revivalSpellEl   = $<HTMLTextAreaElement>("revival-spell");
const copyRevivalBtn   = $<HTMLButtonElement>("copy-revival");

// ── ポルプンテ呪文生成 ────────────────────────────────────────────────────────
const REVIVAL_SUBJECTS = [
  "Turn the central subject into an ancient machine powered by glowing plants.",
  "Reimagine the scene as a miniature world contained inside a crystal artifact.",
  "Transform every major object into a strange living creature while preserving the composition.",
  "Rebuild the scene as a floating city made from unexpected everyday materials.",
  "Create an alternate reality where the subject has evolved for a thousand years.",
];
const REVIVAL_STYLES = [
  "Use cinematic retro science-fantasy concept art with intricate practical details.",
  "Render it as an elaborate hand-painted storybook illustration with surreal geometry.",
  "Use bold 16-bit fantasy game art expanded into a richly detailed modern scene.",
  "Render it as a mysterious museum diorama photographed with dramatic studio lighting.",
  "Use dreamlike mixed media combining paper craft, stained glass, and luminous ink.",
];
const REVIVAL_TWISTS = [
  "Introduce an impossible weather event that changes the meaning of the image.",
  "Add one enormous unexplained object in the distance as the visual mystery.",
  "Reverse the expected scale so tiny details become monumental architecture.",
  "Make gravity behave differently in each part of the scene.",
  "Hide a second narrative in reflections and shadows without adding any text.",
];
function randomItem(arr: string[]) { return arr[Math.floor(Math.random() * arr.length)]; }
function createRevivalSpell(): string {
  return [
    "Using the attached image as the source, create a surprising alternate version of it.",
    randomItem(REVIVAL_SUBJECTS),
    randomItem(REVIVAL_STYLES),
    randomItem(REVIVAL_TWISTS),
    "Keep the original image loosely recognizable, but prioritize unexpected discovery over faithful reproduction. Do not add text, logos, or watermarks.",
  ].join(" ");
}

// ── バトルログ ────────────────────────────────────────────────────────────────
function log(msg: string) {
  if (messageLog[messageLog.length - 1] === msg) return;
  messageLog = [...messageLog, msg].slice(-LOG_MAX);
  dqLog.innerHTML = messageLog
    .map((m, i) => `<p style="${i < messageLog.length - 1 ? "color:#94a3b8" : ""}">${m}</p>`)
    .join("");
}

// ── ステータス描画 ────────────────────────────────────────────────────────────
function renderStatus() {
  const lv = 1 + items.length + pendingItems.length + saveCount;
  sName.textContent = heroName || "?????";
  sLv.textContent   = String(lv).padStart(2, " ");
  sHp.textContent   = String(currentHp).padStart(4, " ");
  sMp.textContent   = String(currentMp).padStart(3, " ");
  cmdNameEl.textContent = heroName || "?????";

  const pct = (currentHp / HP_MAX) * 100;
  dqStatus.dataset.hpStatus = pct <= 10 ? "danger" : pct <= 30 ? "warning" : "";
}

// ── ステージ描画 ──────────────────────────────────────────────────────────────
function renderStage() {
  if (!items.length && !pendingItems.length) {
    dqEnemies.innerHTML = `<div class="dq-enemy" data-kind="ghost">
      <div class="enemy-ghost">👾</div><div class="enemy-label">?????</div></div>`;
    stagePending.hidden = true;
    return;
  }
  dqEnemies.innerHTML = items.slice(0, 4).map((item) => {
    const thumb = item.resultUrl ?? item.previewUrl;
    const label = item.file.name.slice(0, 4);
    return `<div class="dq-enemy" data-kind="imported">
      <img class="enemy-thumb" src="${thumb}" alt="${label}" />
      <div class="enemy-label">${label}</div></div>`;
  }).join("");
  if (pendingItems.length) {
    stagePending.hidden = false;
    stagePending.textContent = `とりこみ待ち：${pendingItems.length}まい ／ 「まほう」→「トリコム」で 仲間にせよ`;
  } else {
    stagePending.hidden = true;
  }
}

// ── コマンド・サブメニュー描画 ────────────────────────────────────────────────
function renderCommands() {
  const hasPending   = pendingItems.length > 0;
  const hasImported  = items.length > 0;
  const hasCompleted = items.some((i) => i.result);

  cmdMagic.disabled  = !hasPending && !hasImported;
  cmdDefend.disabled = !hasCompleted;
  saveZip.disabled   = !hasCompleted;
  saveAll.disabled   = !hasCompleted;
  spellTricom.disabled      = !hasPending;
  spellResize.disabled      = !hasImported;
  spellFormat.disabled      = !hasImported;
  spellTransparent.disabled = !hasImported;
  spellHokante.disabled     = !hasImported;
  spellPolpunte.disabled    = !hasImported;

  cmdMagic.dataset.active  = activeSubmenu === "magic"  ? "true" : "";
  cmdDefend.dataset.active = activeSubmenu === "save"   ? "true" : "";
  cmdEscape.dataset.active = activeSubmenu === "escape" ? "true" : "";

  submenuMagic.hidden  = activeSubmenu !== "magic";
  submenuSave.hidden   = activeSubmenu !== "save";
  submenuEscape.hidden = activeSubmenu !== "escape";

  spellResize.dataset.active      = selectedMagic === "resize"      ? "true" : "";
  spellFormat.dataset.active      = selectedMagic === "format"      ? "true" : "";
  spellTransparent.dataset.active = selectedMagic === "transparent" ? "true" : "";
  spellHokante.dataset.active     = selectedMagic === "hokante"     ? "true" : "";
  spellPolpunte.dataset.active    = selectedMagic === "polpunte"    ? "true" : "";

  const magicOpen = activeSubmenu === "magic";
  configResize.hidden      = !(magicOpen && selectedMagic === "resize");
  configFormat.hidden      = !(magicOpen && selectedMagic === "format");
  configTransparent.hidden = !(magicOpen && selectedMagic === "transparent");
  configHokante.hidden     = !(magicOpen && selectedMagic === "hokante");
  configPolpunte.hidden    = !(magicOpen && selectedMagic === "polpunte");
}

// ── ホカンテ一覧描画 ──────────────────────────────────────────────────────────
function renderHokanteList() {
  hokantList.innerHTML = items.map((item) => {
    const selected = hokanteSelectedIds.includes(item.id);
    const thumb = item.resultUrl ?? item.previewUrl;
    return `<div class="item-card" data-selected="${selected}" data-id="${item.id}" tabindex="0">
      <img class="item-thumb" src="${thumb}" alt="${item.file.name}" />
      <div class="item-info">
        <div class="item-name" title="${item.file.name}">${item.file.name}</div>
        <div class="item-meta">${item.width}×${item.height} / ${formatBytes(item.file.size)}</div>
        ${item.result ? `<div class="item-result">れんきん済み ${formatBytes(item.result.size)}</div>` : ""}
        <div class="item-select-hint">${selected ? "✓ えらばれた" : "タップして えらぶ"}</div>
      </div></div>`;
  }).join("");

  doHokanteBtn.disabled = hokanteSelectedIds.length === 0;
  doHokanteBtn.textContent = hokanteSelectedIds.length
    ? `ホカンテをとなえる（${hokanteSelectedIds.length}まい → かばんへ）`
    : "ホカンテをとなえる";

  hokantList.querySelectorAll<HTMLElement>(".item-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.id ?? "";
      hokanteSelectedIds = hokanteSelectedIds.includes(id)
        ? hokanteSelectedIds.filter((x) => x !== id)
        : [...hokanteSelectedIds, id];
      renderHokanteList();
    });
  });

  stashSection.hidden = stashedItems.length === 0;
  stashList.innerHTML = stashedItems.map((item) => {
    const thumb = item.resultUrl ?? item.previewUrl;
    return `<div class="stash-card">
      <img class="item-thumb" src="${thumb}" alt="${item.file.name}" />
      <div class="item-info">
        <div class="item-name" title="${item.file.name}">${item.file.name}</div>
        <div class="item-meta">${formatBytes(item.file.size)}${item.result ? " / れんきん済み" : ""}</div>
      </div>
      <button class="retrieve-btn" data-stash-id="${item.id}">とりだす</button>
    </div>`;
  }).join("");

  stashList.querySelectorAll<HTMLElement>(".retrieve-btn").forEach((btn) => {
    btn.addEventListener("click", () => retrieveFromStash(btn.dataset.stashId ?? ""));
  });
}

// ── 全体描画 ──────────────────────────────────────────────────────────────────
function render() {
  renderStatus();
  renderStage();
  renderCommands();
  if (!configHokante.hidden) renderHokanteList();
}

// ── HP/MP ─────────────────────────────────────────────────────────────────────
function consumeMp(cost: number): boolean {
  if (cost === 0) return true;
  if (currentMp < cost) {
    // 拡張機能では神の声ダイアログの代わりに自動回復
    currentMp = MP_MAX;
    log("MPが たりない… 神の力で 完全回復した！");
    render();
    return true;
  }
  currentMp = Math.max(0, currentMp - cost);
  return true;
}

function enemyAttack() {
  if (!items.length) return;
  attackCount += 1;
  const isCritical = attackCount % CRITICAL_EVERY === 0;
  const damage = isCritical
    ? Math.max(1, Math.floor(currentHp / 2))
    : 10 + Math.floor(Math.random() * 41);
  currentHp = Math.max(0, currentHp - damage);
  if (isCritical) log("画像のキャラの 痛快ないちげき！");
  else log("画像のキャラの こうげき！");
  log(`${heroName || "ゆうしゃ"}は ${damage}の ダメージを うけた！`);
  if (currentHp <= 0) {
    currentHp = HP_MAX;
    log(`${heroName || "ゆうしゃ"}は よみがえった！`);
  }
  render();
}

function endTurn() { window.setTimeout(enemyAttack, 500); }

// ── まほう：トリコム ──────────────────────────────────────────────────────────
function castTricom() {
  if (!pendingItems.length) return;
  consumeMp(MP_COST_NORMAL);
  const count = pendingItems.length;
  items = [...items, ...pendingItems];
  pendingItems = [];
  selectedMagic = null;
  log(`${heroName || "ゆうしゃ"}は トリコムを となえた！`);
  log(`${count}まいを 仲間にした！ つぎのまほうを えらべ！`);
  render();
  endTurn();
}

// ── まほう：サイチェン / フォマカル / スケル（共通処理） ──────────────────────
async function runForge(magic: "resize" | "format" | "transparent") {
  if (!items.length) return;
  consumeMp(MP_COST_NORMAL);

  const label = magic === "resize" ? "サイチェン" : magic === "format" ? "フォマカル" : "スケル";
  log(`${heroName || "ゆうしゃ"}は ${label}を となえた！`);
  log("れんきん中… どうぐぶくろを ととのえている。");

  processingOverlay.hidden = false;
  progressBar.style.width = "0%";

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    processingMsg.textContent = `れんきん中… ${i + 1} / ${items.length}`;
    try {
      const fmt: OutputFormat = magic === "transparent"
        ? "image/png"
        : magic === "format"
          ? (formatSelect.value as OutputFormat)
          : (item.file.type === "image/png" ? "image/png" : item.file.type === "image/webp" ? "image/webp" : "image/jpeg");

      const targetWidth = magic === "resize" ? Math.max(1, Number(widthInput.value)) : item.width;
      const targetHeight = magic === "resize"
        ? keepRatioInput.checked
          ? Math.max(1, Math.round(targetWidth * item.height / item.width))
          : Math.max(1, Number(heightInput.value))
        : item.height;

      const preparedSource = magic === "transparent"
        ? await removeSolidBackground(item.source, Number(sensitivityInput.value))
        : item.source;

      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);

      const result = await processImage(preparedSource, {
        width: targetWidth,
        height: targetHeight,
        quality: magic === "format" ? Number(qualityInput.value) / 100 : 0.92,
        format: fmt,
      });
      const resultUrl = URL.createObjectURL(result);
      items[i] = { ...item, result, resultUrl, resultFormat: fmt, backgroundRemoved: magic === "transparent" };
    } catch {
      // 失敗した画像はスキップして続行
    }
    progressBar.style.width = `${Math.round(((i + 1) / items.length) * 100)}%`;
  }

  processingOverlay.hidden = true;
  const success = items.filter((item) => item.result).length;
  log(`れんきん成功！ ${success}まいが うまれかわった！`);
  log("「ぼうぎょ」で 完成した画像を ほぞんしよう！");
  activeSubmenu = "save";
  render();
  endTurn();
}

// ── まほう：ホカンテ ──────────────────────────────────────────────────────────
function castHokante() {
  if (!hokanteSelectedIds.length) {
    log("ほかんする 画像を えらんでくれ！");
    return;
  }
  const toStash = items.filter((i) => hokanteSelectedIds.includes(i.id));
  const existingIds = new Set(stashedItems.map((i) => i.id));
  const fresh   = toStash.filter((i) => !existingIds.has(i.id));
  const updated = stashedItems.map((i) => toStash.find((t) => t.id === i.id) ?? i);
  stashedItems = [...updated, ...fresh];
  hokanteSelectedIds = [];
  log(`ホカンテ！ ${toStash.length}まいを かばんに しまった！`);
  log("「ホカンテ」で いつでも とりだせるぞ！");
  render();
  renderHokanteList();
  endTurn();
}

function retrieveFromStash(id: string) {
  const item = stashedItems.find((i) => i.id === id);
  if (!item) return;
  const exists = items.some((i) => i.id === item.id);
  const newItem = exists ? { ...item, id: crypto.randomUUID() } : item;
  items = [...items, newItem];
  stashedItems = stashedItems.filter((i) => i.id !== id);
  log(`「${item.file.name}」を かばんから とりだした！`);
  render();
  renderHokanteList();
}

// ── ダウンロード ──────────────────────────────────────────────────────────────
function triggerDownload(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
}

async function downloadAsZip() {
  const completed = items.filter((i) => i.result && i.resultFormat);
  if (!completed.length) return;
  log("宝箱に 画像を つめている…");
  const zip = new JSZip();
  completed.forEach((item) => {
    if (item.result && item.resultFormat) zip.file(outputName(item.file.name, item.resultFormat), item.result);
  });
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, "gazo-renkin.zip");
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  saveCount += 1;
  log("ZIPの宝箱を 手に入れた！");
  log(`${heroName || "ゆうしゃ"}は レベルが あがった！`);
  render();
}

function downloadIndividually() {
  const completed = items.filter((i) => i.result && i.resultFormat && i.resultUrl);
  completed.forEach((item) => triggerDownload(item.resultUrl!, outputName(item.file.name, item.resultFormat!)));
  saveCount += 1;
  log(`${completed.length}まいを 手に入れた！`);
  log(`${heroName || "ゆうしゃ"}は レベルが あがった！`);
  render();
}

// ── ファイル追加 ──────────────────────────────────────────────────────────────
async function addFiles(fileList: FileList | File[]) {
  const incoming = Array.from(fileList);

  // れんきん済み重複チェック
  const renkinDone = items.filter((i) => i.result);
  const duplicates = incoming.filter((f) =>
    renkinDone.some((i) => i.file.name === f.name && i.file.size === f.size)
  );
  if (duplicates.length) {
    dupFiles.innerHTML = duplicates.map((f) => `<p>・${f.name}</p>`).join("");
    dupWarning.hidden = false;
    return;
  }

  const totalSoFar = items.length + pendingItems.length;
  const sliced = incoming.slice(0, Math.max(0, MAX_FILES - totalSoFar));
  const accepted: ImageItem[] = [];
  const rejected: string[] = [];

  for (const file of sliced) {
    if (!isSupportedFile(file))          { rejected.push(file.name); continue; }
    if (file.size > MAX_FILE_SIZE)       { rejected.push(`${file.name}：50MB超`); continue; }
    try {
      const img = await getImageDimensions(file);
      const previewUrl = URL.createObjectURL(img.source);
      accepted.push({ id: crypto.randomUUID(), file, source: img.source, previewUrl, width: img.width, height: img.height });
    } catch {
      rejected.push(file.name);
    }
  }

  pendingItems = [...pendingItems, ...accepted];
  if (accepted[0]) {
    widthInput.value  = String(accepted[0].width);
    heightInput.value = String(accepted[0].height);
  }
  log(`${accepted.length}まいの 画像が あらわれた！`);
  if (rejected.length) log(`しかし ${rejected.join(" / ")}`);
  log("「まほう」→「トリコム」を おすと 仲間に なる！");
  activeSubmenu = "magic";
  render();
}

// ── 初期化 ────────────────────────────────────────────────────────────────────
try { heroName = localStorage.getItem(HERO_NAME_KEY) ?? ""; } catch { heroName = ""; }
render();

// ── 名前入力モーダル ──────────────────────────────────────────────────────────
const nameModal       = $<HTMLDivElement>("name-modal");
const heroNameInput   = $<HTMLInputElement>("hero-name-input");
const heroNameSubmit  = $<HTMLButtonElement>("hero-name-submit");

function showNameModal() {
  nameModal.hidden = false;
  window.setTimeout(() => heroNameInput.focus(), 50);
}

function submitHeroName() {
  const name = heroNameInput.value.trim().slice(0, 6);
  if (!name) { heroNameInput.focus(); return; }
  heroName = name;
  try { localStorage.setItem(HERO_NAME_KEY, heroName); } catch { /* ignore */ }
  nameModal.hidden = true;
  log(`ゆうしゃ「${heroName}」の 冒険が はじまった！`);
  render();
}

heroNameSubmit.addEventListener("click", submitHeroName);
heroNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitHeroName();
});

if (!heroName) showNameModal();

// ── イベント：ファイル選択 ────────────────────────────────────────────────────
fileInput.addEventListener("change", () => {
  if (fileInput.files) void addFiles(fileInput.files);
  fileInput.value = "";
});

// ── イベント：コマンド ────────────────────────────────────────────────────────
cmdBattle.addEventListener("click", () => {
  activeSubmenu = null; selectedMagic = null; render(); fileInput.click();
});
cmdMagic.addEventListener("click", () => {
  activeSubmenu = activeSubmenu === "magic" ? null : "magic"; render();
});
cmdDefend.addEventListener("click", () => {
  activeSubmenu = activeSubmenu === "save" ? null : "save"; render();
});
cmdEscape.addEventListener("click", () => {
  activeSubmenu = activeSubmenu === "escape" ? null : "escape"; render();
});

// ── イベント：まほう選択 ──────────────────────────────────────────────────────
spellTricom.addEventListener("click", castTricom);
spellResize.addEventListener("click", () => { selectedMagic = "resize"; render(); });
spellFormat.addEventListener("click", () => { selectedMagic = "format"; render(); });
spellTransparent.addEventListener("click", () => { selectedMagic = "transparent"; render(); });
spellHokante.addEventListener("click", () => { selectedMagic = "hokante"; render(); renderHokanteList(); });
spellPolpunte.addEventListener("click", () => { selectedMagic = "polpunte"; render(); });

// ── イベント：設定パネル ──────────────────────────────────────────────────────
$<HTMLButtonElement>("do-resize").addEventListener("click", () => void runForge("resize"));
$<HTMLButtonElement>("do-format").addEventListener("click", () => void runForge("format"));
$<HTMLButtonElement>("do-transparent").addEventListener("click", () => void runForge("transparent"));
doHokanteBtn.addEventListener("click", castHokante);

$<HTMLButtonElement>("hokante-select-all").addEventListener("click", () => {
  const allIds = items.map((i) => i.id);
  hokanteSelectedIds = allIds.every((id) => hokanteSelectedIds.includes(id)) ? [] : allIds;
  renderHokanteList();
});
$<HTMLButtonElement>("clear-stash").addEventListener("click", () => {
  stashedItems = []; renderHokanteList(); log("かばんを 空にした。");
});

$<HTMLButtonElement>("do-polpunte").addEventListener("click", () => {
  consumeMp(MP_COST_POLPUNTE);
  const spell = createRevivalSpell();
  revivalSpellEl.value = spell;
  revivalSection.hidden = false;
  copyRevivalBtn.textContent = "復活の呪文をコピー";
  log(`${heroName || "ゆうしゃ"}は ポルプンテを となえた！`);
  render();
  endTurn();
});
copyRevivalBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(revivalSpellEl.value);
    copyRevivalBtn.textContent = "コピーしました！";
  } catch {
    copyRevivalBtn.textContent = "選択してコピーしてください";
  }
});

// ── イベント：ほぞん ──────────────────────────────────────────────────────────
saveZip.addEventListener("click", () => void downloadAsZip());
saveAll.addEventListener("click", downloadIndividually);

// ── イベント：にげる ──────────────────────────────────────────────────────────
$<HTMLButtonElement>("escape-yes").addEventListener("click", () => window.close());
$<HTMLButtonElement>("escape-no").addEventListener("click", () => {
  activeSubmenu = null; render(); log(`${heroName || "ゆうしゃ"}は にげるのをやめた！`);
});

// ── イベント：設定入力 ────────────────────────────────────────────────────────
widthInput.addEventListener("input", () => {
  if (!keepRatioInput.checked || !items[0]) return;
  heightInput.value = String(Math.max(1, Math.round(Number(widthInput.value) * items[0].height / items[0].width)));
});
heightInput.addEventListener("input", () => {
  if (!keepRatioInput.checked || !items[0]) return;
  widthInput.value = String(Math.max(1, Math.round(Number(heightInput.value) * items[0].width / items[0].height)));
});
keepRatioInput.addEventListener("change", () => {
  heightInput.disabled = keepRatioInput.checked;
  widthInput.dispatchEvent(new Event("input"));
});
qualityInput.addEventListener("input", () => { qualityValue.value = qualityInput.value; });
formatSelect.addEventListener("change", () => {
  qualityInput.disabled = formatSelect.value === "image/png";
  $<HTMLElement>("format-note").hidden = formatSelect.value !== "image/png";
});
sensitivityInput.addEventListener("input", () => {
  const v = Number(sensitivityInput.value);
  sensitivityLabel.textContent = v <= 25 ? "厳密" : v <= 55 ? "標準" : "広め";
});

// ── イベント：重複警告 ────────────────────────────────────────────────────────
$<HTMLButtonElement>("dup-ok").addEventListener("click", () => { dupWarning.hidden = true; });
