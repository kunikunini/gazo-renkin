"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  formatBytes,
  getImageDimensions,
  isSupportedFile,
  outputName,
  processImage,
  removeSolidBackground,
  type OutputFormat,
} from "@/lib/image-processing";

const HERO_NAME_KEY = "gazo-renkin:hero-name";
const HERO_NAME_MAX = 6;
const SOUND_MUTED_KEY = "gazo-renkin:muted";
const BGM_TRACKS = ["/BGM3.mp3", "/BGM2.wav", "/BGM1.mp3", "/BGM4.wav"];
const BGM_VOLUME = 0.075;
const TYPE_INTERVAL_MS = 38; // 1文字あたり
const BEEP_EVERY = 2; // 何文字おきにビープを鳴らすか
const HP_MAX = 1080;
const MP_MAX = 80;
const MP_COST_NORMAL = 2;
const MP_COST_POLPUNTE = 20;
const CRITICAL_EVERY = 3; // 何回に1回 痛快ないちげき
const FAMICOM_PASSWORD = "1983";

function stripExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function enemyLabel(fileName: string) {
  // ファイル名の先頭4文字（拡張子を除外）
  const base = stripExtension(fileName).trim();
  return base.slice(0, 4) || "????";
}

function padNumber(value: number, width = 3) {
  return value.toString().padStart(width, " ");
}

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
  error?: string;
};

type MagicName = "tricom" | "hokante" | "resize" | "format" | "transparent" | "polpunte";
type CommandView = "magic" | "save" | "escape" | null;
type RenkinPhase = "INITIAL" | "STAGED" | "READY";
const LOG_LIMIT = 10;

const MAX_FILES = 25;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

type PixelIconName = "picture" | "bag" | "shield" | "flask" | "chest" | "orb";

function PixelIcon({ name, className = "" }: { name: PixelIconName; className?: string }) {
  return (
    <Image
      aria-hidden="true"
      className={`pixel-icon ${className}`}
      src={`/assets/icons/${name}.png`}
      alt=""
      width={64}
      height={64}
    />
  );
}

function qualityStatus(quality: number) {
  if (quality >= 90) return { label: "高画質", note: "きれい・容量大きめ" };
  if (quality >= 75) return { label: "標準", note: "画質と軽さのバランス" };
  if (quality >= 55) return { label: "軽量", note: "少し粗い・容量小さめ" };
  return { label: "最軽量", note: "画質を抑えて最小化" };
}

function backgroundSensitivityStatus(sensitivity: number) {
  if (sensitivity <= 25) return "厳密";
  if (sensitivity <= 55) return "標準";
  return "広め";
}

function estimateOutputBytes(
  items: ImageItem[],
  format: OutputFormat,
  quality: number,
) {
  if (!items.length) return null;

  return items.reduce((total, item) => {
    const formatFactor = format === "image/png" ? 1.15 : format === "image/jpeg" ? 0.82 : 0.62;
    const qualityFactor = format === "image/png"
      ? 1
      : 0.18 + 0.82 * (quality / 100) ** 1.7;
    return total + item.file.size * formatFactor * qualityFactor;
  }, 0);
}

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

function randomItem(items: string[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function createRevivalSpell() {
  return [
    "Using the attached image as the source, create a surprising alternate version of it.",
    randomItem(REVIVAL_SUBJECTS),
    randomItem(REVIVAL_STYLES),
    randomItem(REVIVAL_TWISTS),
    "Keep the original image loosely recognizable, but prioritize unexpected discovery over faithful reproduction. Do not add text, logos, or watermarks.",
  ].join(" ");
}

function triggerDownload(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
}

function sourceOutputFormat(item: ImageItem): OutputFormat {
  if (item.file.type === "image/png") return "image/png";
  if (item.file.type === "image/webp") return "image/webp";
  return "image/jpeg";
}

export function ImageForge() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [pendingItems, setPendingItems] = useState<ImageItem[]>([]);
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(800);
  const [keepRatio, setKeepRatio] = useState(true);
  const [format, setFormat] = useState<OutputFormat>("image/webp");
  const [quality, setQuality] = useState(82);
  const [backgroundSensitivity, setBackgroundSensitivity] = useState(38);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messageLog, setMessageLog] = useState<string[]>([
    "「たたかう」で れんきんしたい画像を えらぶのだ！",
  ]);
  const [revivalSpell, setRevivalSpell] = useState("");
  const [copyLabel, setCopyLabel] = useState("復活の呪文を コピー");
  const [commandView, setCommandView] = useState<CommandView>(null);
  const [selectedMagic, setSelectedMagic] = useState<MagicName | null>(null);
  const [savedResultIds, setSavedResultIds] = useState<string[]>([]);
  const [exitNotice, setExitNotice] = useState(false);
  const [heroName, setHeroName] = useState<string>("");
  const [heroNameLoaded, setHeroNameLoaded] = useState(false);
  const [pendingHeroName, setPendingHeroName] = useState("");
  const [showSplash, setShowSplash] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());
  const magicConfigRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const bgmIndexRef = useRef(0);
  const bgmStarted = useRef(false);
  const [typedIndex, setTypedIndex] = useState(0);
  const [isSoundMuted, setIsSoundMuted] = useState(false);
  // バトルステータス
  const [currentHp, setCurrentHp] = useState(HP_MAX);
  const [currentMp, setCurrentMp] = useState(MP_MAX);
  const [saveCount, setSaveCount] = useState(0);
  const [attackCount, setAttackCount] = useState(0);
  const [damageFlash, setDamageFlash] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [showGodPassword, setShowGodPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  // ホカンテ：アプリ内一時保存かばん
  const [stashedItems, setStashedItems] = useState<ImageItem[]>([]);
  const [hokanteSelectedIds, setHokanteSelectedIds] = useState<string[]>([]);
  // 重複警告
  const [duplicateWarningFiles, setDuplicateWarningFiles] = useState<string[]>([]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // 初回起動時：localStorageから主人公の名前を読み込み（外部システム同期のため例外的にeffect内でsetState）
  useEffect(() => {
    if (typeof window === "undefined") return;
    let next = "";
    try {
      const saved = window.localStorage.getItem(HERO_NAME_KEY);
      if (saved && saved.trim()) next = saved.trim();
    } catch {
      // localStorageが使えない環境では未設定として扱う
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeroName(next);
    setHeroNameLoaded(true);
  }, []);

  function confirmHeroName() {
    const next = pendingHeroName.trim().slice(0, HERO_NAME_MAX);
    if (!next) return;
    setHeroName(next);
    try {
      window.localStorage.setItem(HERO_NAME_KEY, next);
    } catch {
      // 保存失敗は無視（セッション内では動作する）
    }
    // 名前確定はユーザー操作なので、ここでAudioContextを初期化（ブラウザ制約対応）
    ensureAudioContext();
  }

  // ミュート状態を localStorage から復元
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(SOUND_MUTED_KEY);
      if (stored === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsSoundMuted(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // BGM ミュート同期
  useEffect(() => {
    if (!bgmRef.current) return;
    if (isSoundMuted) {
      bgmRef.current.pause();
    } else {
      void bgmRef.current.play().catch(() => {});
    }
  }, [isSoundMuted]);

  function toggleSound() {
    setIsSoundMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SOUND_MUTED_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
    ensureAudioContext();
  }

  function ensureAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      } catch {
        audioCtxRef.current = null;
      }
    }
    // suspended状態のときは再開
    if (audioCtxRef.current?.state === "suspended") {
      void audioCtxRef.current.resume();
    }
    // BGM初回起動
    startBgm();
    return audioCtxRef.current;
  }

  function playBgmTrack(index: number) {
    bgmIndexRef.current = index;
    const audio = new Audio(BGM_TRACKS[index]);
    audio.volume = BGM_VOLUME;
    bgmRef.current = audio;
    audio.addEventListener("ended", () => {
      const next = (bgmIndexRef.current + 1) % BGM_TRACKS.length;
      playBgmTrack(next);
    });
    void audio.play().catch(() => {});
  }

  function startBgm() {
    if (bgmStarted.current) return;
    bgmStarted.current = true;
    playBgmTrack(0);
  }

  // DQ風「ピポン」（短い矩形波 + 少しのピッチ揺らぎ）
  function playBeep() {
    if (isSoundMuted) return;
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state !== "running") return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      // eslint-disable-next-line react-hooks/purity
      osc.frequency.value = 760 + Math.random() * 90;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.045, t);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
      osc.start(t);
      osc.stop(t + 0.05);
    } catch {
      // 失敗しても無視
    }
  }

  // まほう発動SE：3音アップ→1音ピン！の「テレレ ピン」
  function playMagicSound() {
    if (isSoundMuted) return;
    const ctx = ensureAudioContext();
    if (!ctx || ctx.state !== "running") return;
    try {
      // C5, E5, G5, C6
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const base = ctx.currentTime;
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.value = freq;
        const t = base + i * 0.055;
        const peak = i === notes.length - 1 ? 0.07 : 0.05;
        const dur = i === notes.length - 1 ? 0.22 : 0.09;
        gain.gain.setValueAtTime(peak, t);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + dur);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      });
    } catch {
      // 失敗しても無視
    }
  }

  // レベルアップSE：DQ風 ファンファーレ
  function playSaveSound() {
    if (isSoundMuted) return;
    const ctx = ensureAudioContext();
    if (!ctx || ctx.state !== "running") return;
    try {
      // ティロリロリン↑ ティロリン↑↑〜
      const sequence: Array<{ freq: number; dur: number }> = [
        { freq: 523.25, dur: 0.08 },  // C5
        { freq: 659.25, dur: 0.08 },  // E5
        { freq: 783.99, dur: 0.08 },  // G5
        { freq: 1046.5, dur: 0.08 },  // C6
        { freq: 783.99, dur: 0.08 },  // G5
        { freq: 1046.5, dur: 0.45 },  // C6（ロングトーン）
      ];
      let acc = 0;
      sequence.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "triangle";
        osc.frequency.value = n.freq;
        const t = ctx.currentTime + acc;
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + n.dur);
        osc.start(t);
        osc.stop(t + n.dur + 0.02);
        acc += n.dur * 0.88;
      });
      // 重ねて5度上のハモり（最後の音）
      const harmonyOsc = ctx.createOscillator();
      const harmonyGain = ctx.createGain();
      harmonyOsc.connect(harmonyGain);
      harmonyGain.connect(ctx.destination);
      harmonyOsc.type = "triangle";
      harmonyOsc.frequency.value = 1567.98; // G6
      const ht = ctx.currentTime + acc - 0.45 * 0.88;
      harmonyGain.gain.setValueAtTime(0.05, ht);
      harmonyGain.gain.exponentialRampToValueAtTime(0.0005, ht + 0.45);
      harmonyOsc.start(ht);
      harmonyOsc.stop(ht + 0.5);
    } catch {
      // 失敗しても無視
    }
  }

  // 打撃SE：低音ブー＋ノイズ
  function playHitSound() {
    if (isSoundMuted) return;
    const ctx = ensureAudioContext();
    if (!ctx || ctx.state !== "running") return;
    try {
      const t = ctx.currentTime;
      // 低音ピッチ落ち
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.15);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
      osc.start(t);
      osc.stop(t + 0.22);
      // ノイズバースト
      const bufferSize = ctx.sampleRate * 0.08;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        // eslint-disable-next-line react-hooks/purity
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const noiseSrc = ctx.createBufferSource();
      const noiseGain = ctx.createGain();
      noiseSrc.buffer = noiseBuffer;
      noiseSrc.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noiseGain.gain.value = 0.12;
      noiseSrc.start(t);
    } catch {
      // 失敗しても無視
    }
  }

  // DQ風メッセージログに追加（同一連続メッセージは抑制）
  function logMessage(msg: string) {
    setMessageLog((current) => {
      if (current[current.length - 1] === msg) return current;
      return [...current, msg].slice(-LOG_LIMIT);
    });
  }

  // タイプライター演出：新メッセージが入るたびに最新行を1文字ずつ表示
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!messageLog.length) return;
    const latest = messageLog[messageLog.length - 1];

    // motion低減ユーザーには即時表示
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTypedIndex(latest.length);
      return;
    }

    setTypedIndex(0);
    let i = 0;
    const tick = () => {
      i += 1;
      setTypedIndex(i);
      if (i % BEEP_EVERY === 0) playBeep();
      if (i < latest.length) {
        typingTimerRef.current = window.setTimeout(tick, TYPE_INTERVAL_MS);
      } else {
        typingTimerRef.current = null;
      }
    };
    typingTimerRef.current = window.setTimeout(tick, TYPE_INTERVAL_MS);
    return () => {
      if (typingTimerRef.current) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageLog]);

  // クリックでタイピングをスキップ
  function skipTyping() {
    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (messageLog.length) {
      const last = messageLog[messageLog.length - 1];
      setTypedIndex(last.length);
    }
  }

  const completed = useMemo(() => items.filter((item) => item.result), [items]);
  const qualityInfo = qualityStatus(quality);
  const hasUnsavedResults = completed.some((item) => !savedResultIds.includes(item.id));
  const estimatedTotalBytes = useMemo(
    () => estimateOutputBytes(items, format, quality),
    [items, format, quality],
  );

  // DQ風ステータス：LV=1 + 画像枚数 + 保存数、HP/MPは可変
  const heroLevel = 1 + items.length + pendingItems.length + saveCount;
  const heroHp = currentHp;
  const heroMp = currentMp;

  // HP警告ステータス
  const hpPercent = (currentHp / HP_MAX) * 100;
  const hpStatus = hpPercent <= 10 ? "danger" : hpPercent <= 30 ? "warning" : undefined;

  // フェーズ判定
  const phase: RenkinPhase =
    items.length > 0 ? "READY" : pendingItems.length > 0 ? "STAGED" : "INITIAL";

  // コマンド有効/無効
  const canBattle = true; // 常に「たたかう」は使える
  const canMagic = phase !== "INITIAL"; // 画像が pending or imported のとき
  const canDefend = phase === "READY"; // 取り込み済みがないとほぞんできない
  const canEscape = true; // にげる は常時可能（事故防止）

  // まほう個別の有効/無効
  const canTricom = pendingItems.length > 0;
  const hasImported = items.length > 0;
  const canHokante = hasImported;
  const canResize = hasImported;
  const canFormat = hasImported;
  const canTransparent = hasImported;
  const canPolpunte = hasImported;

  // 次にやるべきアクション（ガイド用）
  const nextStep: "battle" | "magic-tricom" | "magic-any" | "save" | null = (() => {
    if (phase === "INITIAL") return "battle";
    if (phase === "STAGED") return "magic-tricom";
    if (phase === "READY" && !completed.length) return "magic-any";
    if (phase === "READY" && completed.length && hasUnsavedResults) return "save";
    return null;
  })();

  // 次にやるべき「カード」を判定（白枠グロー用）
  // - 設定パネル（magic config / hokante / polpunte）が表示中 → そのカード
  // - サブメニューが開いている → サブメニューカード
  // - それ以外で次があれば → コマンドボックス
  const magicConfigOpen =
    commandView === "magic" &&
    (selectedMagic === "resize" ||
      selectedMagic === "format" ||
      selectedMagic === "transparent" ||
      selectedMagic === "hokante" ||
      selectedMagic === "polpunte");
  const glowTarget: "battle" | "submenu" | "config" | null = (() => {
    if (magicConfigOpen) return "config";
    if (commandView) return "submenu";
    if (nextStep) return "battle"; // コマンドボックス側
    return null;
  })();

  async function addFiles(fileList: FileList | File[]) {
    const totalSoFar = items.length + pendingItems.length;
    const allIncoming = Array.from(fileList);

    // れんきん済み画像との重複チェック（name + size で同一ファイルを判定）
    const renkinDone = items.filter((i) => i.result);
    const duplicates = allIncoming.filter((f) =>
      renkinDone.some((i) => i.file.name === f.name && i.file.size === f.size)
    );
    if (duplicates.length > 0) {
      setDuplicateWarningFiles(duplicates.map((f) => f.name));
      return;
    }

    const incoming = allIncoming.slice(0, Math.max(0, MAX_FILES - totalSoFar));
    if (!incoming.length) return;

    logMessage("画像の ステータスを しらべている…");
    const accepted: ImageItem[] = [];
    const rejected: string[] = [];

    for (const file of incoming) {
      if (!isSupportedFile(file)) {
        rejected.push(`${file.name}：対応していない形式`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name}：50MBをこえています`);
        continue;
      }

      try {
        const image = await getImageDimensions(file);
        const previewUrl = URL.createObjectURL(image.source);
        objectUrls.current.add(previewUrl);
        accepted.push({
          id: crypto.randomUUID(),
          file,
          source: image.source,
          previewUrl,
          width: image.width,
          height: image.height,
        });
      } catch {
        rejected.push(`${file.name}：画像を読み込めませんでした`);
      }
    }

    setPendingItems((current) => [...current, ...accepted]);
    if (totalSoFar === 0 && accepted[0]) {
      setWidth(accepted[0].width);
      setHeight(accepted[0].height);
    }
    logMessage(`${accepted.length}まいの 画像が あらわれた！`);
    if (rejected.length) logMessage(`しかし ${rejected.join(" ／ ")}`);
    logMessage("「まほう」→「トリコム」を おすと 仲間に なる！");
    // 自動で「まほう」サブメニューを開く（トリコムがハイライト＆即実行可能）
    setCommandView("magic");
    setSelectedMagic(null);
  }

  // ====== バトル系ヘルパー ======
  function magicMpCost(name: MagicName): number {
    if (name === "polpunte") return MP_COST_POLPUNTE;
    if (name === "hokante") return 0;
    return MP_COST_NORMAL;
  }

  // MPチェック → 不足なら神の声を呼ぶ。OKならtrueを返す
  function tryConsumeMp(name: MagicName): boolean {
    const cost = magicMpCost(name);
    if (cost === 0) return true;
    if (currentMp < cost) {
      setShowGodPassword(true);
      logMessage("MPが たりない…");
      logMessage("天から ふしぎな こえが きこえる！");
      return false;
    }
    setCurrentMp((mp) => Math.max(0, mp - cost));
    return true;
  }

  function triggerDamageFlash() {
    setDamageFlash(true);
    window.setTimeout(() => setDamageFlash(false), 320);
  }

  // 敵の反撃：3回に1回 痛快ないちげき（HP半減）、それ以外は10〜50ランダム
  function enemyAttack() {
    if (showGameOver) return;
    if (items.length === 0) return; // 敵がいないなら反撃なし
    const nextCount = attackCount + 1;
    setAttackCount(nextCount);
    const isCritical = nextCount % CRITICAL_EVERY === 0;
    const damage = isCritical
      ? Math.max(1, Math.floor(currentHp / 2))
      // eslint-disable-next-line react-hooks/purity
      : 10 + Math.floor(Math.random() * 41);
    const newHp = Math.max(0, currentHp - damage);
    setCurrentHp(newHp);
    triggerDamageFlash();
    playHitSound();
    if (isCritical) {
      logMessage("画像のキャラの 痛快ないちげき！");
    } else {
      logMessage("画像のキャラの こうげき！");
    }
    logMessage(`${heroName || "ゆうしゃ"}は ${damage}の ダメージを うけた！`);
    if (newHp <= 0) {
      setShowGameOver(true);
      logMessage(`${heroName || "ゆうしゃ"}は ちからつきてしまった…`);
    }
  }

  // 1ターン終了：少し遅延を入れて敵反撃
  function endTurn() {
    window.setTimeout(() => enemyAttack(), 500);
  }

  function handlePasswordSubmit() {
    if (passwordInput.trim() === FAMICOM_PASSWORD) {
      setCurrentMp(MP_MAX);
      setShowGodPassword(false);
      setPasswordInput("");
      setPasswordError("");
      logMessage("神は MPを 完全回復してくれた！");
      playSaveSound();
    } else {
      setPasswordError("ちがう！ もういちど となえよ！");
    }
  }

  function revive() {
    setCurrentHp(HP_MAX);
    setCurrentMp(MP_MAX);
    setAttackCount(0);
    setShowGameOver(false);
    logMessage(`${heroName || "ゆうしゃ"}は よみがえった！`);
    playSaveSound();
  }

  // まほう選択＋設定パネルへスクロール（タイミングはレンダ後）
  function selectMagicAndScroll(name: MagicName) {
    setSelectedMagic(name);
    requestAnimationFrame(() => {
      magicConfigRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ホカンテ：選択した画像をアプリ内かばんに一時保存（ダウンロードしない）
  function castHokante() {
    if (!hokanteSelectedIds.length) {
      logMessage("ほかんする 画像を えらんでくれ！");
      return;
    }
    const toStash = items.filter((item) => hokanteSelectedIds.includes(item.id));
    setStashedItems((current) => {
      // 同じIDがすでにあれば更新、なければ追加
      const existingIds = new Set(current.map((i) => i.id));
      const fresh = toStash.filter((i) => !existingIds.has(i.id));
      const updated = current.map((i) => {
        const match = toStash.find((t) => t.id === i.id);
        return match ?? i;
      });
      return [...updated, ...fresh];
    });
    setHokanteSelectedIds([]);
    playMagicSound();
    logMessage(`ホカンテ！ ${toStash.length}まいを かばんに しまった！`);
    logMessage("「まほう」→「ホカンテ」で いつでも とりだせるぞ！");
    endTurn();
  }

  function retrieveFromStash(id: string) {
    const item = stashedItems.find((i) => i.id === id);
    if (!item) return;
    // すでに items にある ID と被らないよう新規 ID で追加
    const exists = items.some((i) => i.id === item.id);
    const newItem = exists ? { ...item, id: crypto.randomUUID() } : item;
    setItems((current) => [...current, newItem]);
    setStashedItems((current) => current.filter((i) => i.id !== id));
    logMessage(`「${item.file.name}」を かばんから とりだした！`);
  }

  function clearStash() {
    // stash の objectURL を解放してから消す
    stashedItems.forEach((item) => {
      // items にも同じURLが残っている可能性があるので revoke は慎重に
      const inItems = items.some((i) => i.previewUrl === item.previewUrl);
      if (!inItems) {
        URL.revokeObjectURL(item.previewUrl);
        objectUrls.current.delete(item.previewUrl);
      }
      if (item.resultUrl) {
        const inItemsResult = items.some((i) => i.resultUrl === item.resultUrl);
        if (!inItemsResult) {
          URL.revokeObjectURL(item.resultUrl);
          objectUrls.current.delete(item.resultUrl);
        }
      }
    });
    setStashedItems([]);
    logMessage("かばんを 空にした。");
  }

  function castTricom() {
    if (!pendingItems.length) return;
    if (!tryConsumeMp("tricom")) return;
    playMagicSound();
    setItems((current) => [...current, ...pendingItems]);
    const count = pendingItems.length;
    setPendingItems([]);
    setSelectedMagic(null);
    // まほうサブメニューは開いたまま：そのまま次のまほうを選びやすく
    setCommandView("magic");
    logMessage(`${heroName || "ゆうしゃ"}は トリコムを となえた！`);
    logMessage(`${count}まいを 仲間にした！ キャラの すがたが あらわれた！`);
    logMessage("つぎの「まほう」を えらべ！（サイチェン / フォマカル / スケル / ポルプンテ）");
    endTurn();
  }

  function updateWidth(nextWidth: number) {
    const safeWidth = Math.max(1, nextWidth || 1);
    setWidth(safeWidth);
    if (keepRatio && items[0]) {
      setHeight(Math.max(1, Math.round(safeWidth * (items[0].height / items[0].width))));
    }
  }

  function updateHeight(nextHeight: number) {
    const safeHeight = Math.max(1, nextHeight || 1);
    setHeight(safeHeight);
    if (keepRatio && items[0]) {
      setWidth(Math.max(1, Math.round(safeHeight * (items[0].width / items[0].height))));
    }
  }

  async function forgeAll() {
    if (
      !items.length ||
      isProcessing ||
      !selectedMagic ||
      selectedMagic === "polpunte" ||
      selectedMagic === "tricom" ||
      selectedMagic === "hokante"
    )
      return;
    // MPチェック
    if (selectedMagic === "resize" || selectedMagic === "format" || selectedMagic === "transparent") {
      if (!tryConsumeMp(selectedMagic)) return;
    }
    setIsProcessing(true);
    playMagicSound();
    const magicLabel =
      selectedMagic === "resize"
        ? "サイチェン"
        : selectedMagic === "format"
          ? "フォマカル"
          : "スケル";
    logMessage(`${heroName || "ゆうしゃ"}は ${magicLabel}を となえた！`);
    logMessage("れんきん中… どうぐぶくろを ととのえている。");

    const nextItems = [...items];
    for (let index = 0; index < nextItems.length; index += 1) {
      const item = nextItems[index];
      try {
        if (item.resultUrl) {
          URL.revokeObjectURL(item.resultUrl);
          objectUrls.current.delete(item.resultUrl);
        }
        const isResize = selectedMagic === "resize";
        const isTransparent = selectedMagic === "transparent";
        const targetWidth = isResize ? width : item.width;
        const targetHeight = isResize
          ? keepRatio
            ? Math.max(1, Math.round(targetWidth / (item.width / item.height)))
            : height
          : item.height;
        const preparedSource = isTransparent
          ? await removeSolidBackground(item.source, backgroundSensitivity)
          : item.source;
        const resultFormat: OutputFormat = isTransparent
          ? "image/png"
          : selectedMagic === "format"
            ? format
            : sourceOutputFormat(item);
        const result = await processImage(preparedSource, {
          width: targetWidth,
          height: targetHeight,
          quality: selectedMagic === "format" ? quality / 100 : 0.92,
          format: resultFormat,
        });
        const resultUrl = URL.createObjectURL(result);
        objectUrls.current.add(resultUrl);
        nextItems[index] = {
          ...item,
          result,
          resultUrl,
          resultFormat,
          backgroundRemoved: isTransparent,
          error: undefined,
        };
      } catch (error) {
        nextItems[index] = {
          ...item,
          error: error instanceof Error ? error.message : "れんきんに失敗しました。",
        };
      }
      setItems([...nextItems]);
    }

    const successCount = nextItems.filter((item) => item.result).length;
    logMessage(`れんきん成功！ ${successCount}まいが うまれかわった！`);
    logMessage("「ぼうぎょ」で 完成した画像を ほぞんしよう！");
    setSavedResultIds([]);
    setCommandView("save");
    setIsProcessing(false);
    endTurn();
  }

  function releaseItem(item: ImageItem) {
    URL.revokeObjectURL(item.previewUrl);
    objectUrls.current.delete(item.previewUrl);
    if (item.resultUrl) {
      URL.revokeObjectURL(item.resultUrl);
      objectUrls.current.delete(item.resultUrl);
    }
  }

  function removeItem(id: string) {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target) releaseItem(target);
      return current.filter((item) => item.id !== id);
    });
    setPendingItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target) releaseItem(target);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearAll() {
    items.forEach(releaseItem);
    pendingItems.forEach(releaseItem);
    setItems([]);
    setPendingItems([]);
    setSavedResultIds([]);
    setSelectedMagic(null);
    setCommandView(null);
    setHokanteSelectedIds([]);
    logMessage("どうぐぶくろを 空にした。（かばんの中身は のこっている）");
    if (inputRef.current) inputRef.current.value = "";
  }

  function levelUp() {
    setSaveCount((c) => c + 1);
    playSaveSound();
    logMessage(`${heroName || "ゆうしゃ"}は レベルが あがった！`);
  }

  async function downloadZip() {
    if (!completed.length) return;
    logMessage("宝箱に 画像を つめている…");
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    completed.forEach((item) => {
      if (item.result && item.resultFormat) {
        zip.file(outputName(item.file.name, item.resultFormat), item.result);
      }
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "gazo-renkin.zip");
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    logMessage("ZIPの宝箱を 手に入れた！");
    setSavedResultIds(completed.map((item) => item.id));
    levelUp();
  }

  // SE抜きの保存処理（一括保存で連発しないよう内部用）
  function triggerSaveDownload(item: ImageItem) {
    if (!item.resultUrl) return;
    triggerDownload(item.resultUrl, outputName(item.file.name, item.resultFormat ?? format));
    setSavedResultIds((current) => current.includes(item.id) ? current : [...current, item.id]);
  }

  function saveOne(item: ImageItem) {
    if (!item.resultUrl) return;
    triggerSaveDownload(item);
    logMessage(`「${item.file.name}」を 手に入れた！`);
    levelUp();
  }

  function saveAllIndividually() {
    if (!completed.length) return;
    completed.forEach(triggerSaveDownload);
    logMessage(`${completed.length}まいを 手に入れた！`);
    levelUp();
  }

  function exitAdventure() {
    setCommandView(null);
    logMessage("ゆうしゃは にげだした！");
    window.close();
    window.setTimeout(() => {
      if (document.visibilityState === "visible") setExitNotice(true);
    }, 150);
  }

  async function copyRevivalSpell() {
    if (!revivalSpell) return;
    try {
      await navigator.clipboard.writeText(revivalSpell);
      setCopyLabel("コピーしました");
    } catch {
      setCopyLabel("選択して コピーしてください");
    }
  }

  // 表示する敵リスト（pending=魔法使い影／imported=実画像サムネ）
  type EnemyKind = "ghost" | "pending" | "imported";
  type EnemyEntry = {
    id: string;
    label: string;
    count: number;
    kind: EnemyKind;
    thumbnailUrl?: string;
  };

  const enemyEntries: EnemyEntry[] = (() => {
    if (!items.length && !pendingItems.length) {
      return [{ id: "ghost", label: "?????", count: 0, kind: "ghost" }];
    }
    type Group = { label: string; pending: number; imported: ImageItem[] };
    const groups = new Map<string, Group>();
    const ensure = (label: string): Group => {
      const existing = groups.get(label);
      if (existing) return existing;
      const fresh: Group = { label, pending: 0, imported: [] };
      groups.set(label, fresh);
      return fresh;
    };
    for (const item of pendingItems) ensure(enemyLabel(item.file.name)).pending += 1;
    for (const item of items) ensure(enemyLabel(item.file.name)).imported.push(item);

    return Array.from(groups.values()).map((group): EnemyEntry => {
      const total = group.pending + group.imported.length;
      const firstImported = group.imported[0];
      const kind: EnemyKind = firstImported ? "imported" : "pending";
      return {
        id: group.label,
        label: group.label,
        count: total,
        kind,
        thumbnailUrl: firstImported?.previewUrl,
      };
    });
  })();

  const showNameModal = heroNameLoaded && !heroName;

  return (
    <section id="forge" className="space-y-7" aria-label="画像れんきん所">
      <div className="game-window dq-battle p-3 sm:p-5">
        {/* 上部：パーティーステータス */}
        <div className="dq-status" role="group" aria-label="パーティーステータス" data-hp-status={hpStatus}>
          <div className="dq-status-head" aria-hidden="true">
            <span>なまえ</span>
            <span>LV</span>
            <span>HP</span>
            <span>MP</span>
          </div>
          <div className="dq-status-row">
            <span className="dq-name">{heroName || "?????"}</span>
            <span className="dq-num">{padNumber(heroLevel, 2)}</span>
            <span className="dq-num">{padNumber(heroHp, 4)}</span>
            <span className="dq-num">{padNumber(heroMp, 3)}</span>
          </div>
        </div>

        {/* 中央：敵キャラクター（魔法使い／取り込み後は実画像） D&D受付 */}
        <div
          className="dq-stage"
          aria-label="エンカウント中"
          data-dragging={isDragging || undefined}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
        >
          <div className="dq-enemies" data-count={Math.min(enemyEntries.length, 4)}>
            {enemyEntries.slice(0, 4).map((enemy) => (
              <div className="dq-enemy" key={enemy.id} title={enemy.label} data-kind={enemy.kind}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="dq-enemy-img"
                  src={
                    enemy.kind === "imported" && enemy.thumbnailUrl
                      ? enemy.thumbnailUrl
                      : "/assets/icons/magic_sloth.png"
                  }
                  alt={`敵：${enemy.label}`}
                  width={140}
                  height={140}
                />
                {enemy.count > 1 && <span className="dq-enemy-count">×{enemy.count}</span>}
              </div>
            ))}
          </div>
          {enemyEntries.length > 4 && (
            <p className="dq-enemy-overflow">ほか {enemyEntries.length - 4} 種があらわれた！</p>
          )}
          {isDragging && (
            <div className="dq-stage-drop-hint" aria-hidden="true">
              ここに ドロップして 仲間にする
            </div>
          )}
          {pendingItems.length > 0 && (
            <p className="dq-stage-pending">
              とりこみ待ち：{pendingItems.length}まい ／ 「まほう」→「トリコム」で 仲間にせよ
            </p>
          )}
        </div>

        {/* 下部：コマンド + 敵情報カード */}
        <div className="dq-bottom">
          <div className="dq-command-box" role="group" aria-label="コマンド" data-glow={glowTarget === "battle" ? true : undefined}>
            <p className="dq-command-name">{heroName || "?????"}</p>
            <ul className="dq-command-list" aria-label="冒険コマンド">
              <li>
                <button
                  type="button"
                  disabled={!canBattle}
                  data-next={nextStep === "battle"}
                  onClick={() => {
                    ensureAudioContext();
                    setCommandView(null);
                    logMessage(`${heroName || "ゆうしゃ"}は「たたかう」を えらんだ！`);
                    inputRef.current?.click();
                  }}
                >
                  <span>たたかう</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  disabled={!canMagic}
                  data-active={commandView === "magic"}
                  data-next={nextStep === "magic-tricom" || nextStep === "magic-any"}
                  title={!canMagic ? "まず「たたかう」で画像を えらぶのだ" : undefined}
                  onClick={() => {
                    if (commandView === "magic") {
                      setCommandView(null);
                    } else {
                      setCommandView("magic");
                      logMessage(`${heroName || "ゆうしゃ"}は まほうを えらぼうとしている…`);
                    }
                  }}
                >
                  <span>まほう</span>
                  <small className="dq-toggle-mark">{commandView === "magic" ? "▼" : "▶"}</small>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  disabled={!canDefend}
                  data-active={commandView === "save"}
                  data-next={nextStep === "save"}
                  title={!canDefend ? "まず「トリコム」で画像を なかまにせよ" : undefined}
                  onClick={() => {
                    if (commandView === "save" && !completed.length) {
                      // 結果がまだない場合だけ閉じる（iPhoneで誤タップで閉まらないように）
                      setCommandView(null);
                    } else {
                      setCommandView("save");
                      if (commandView !== "save") {
                        logMessage(`${heroName || "ゆうしゃ"}は ぼうぎょの たいせいに 入った…`);
                      }
                    }
                  }}
                >
                  <span>ぼうぎょ</span>
                  <small className="dq-toggle-mark">{commandView === "save" ? "▼" : "▶"}</small>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  disabled={!canEscape}
                  data-active={commandView === "escape"}
                  onClick={() => {
                    if (commandView === "escape") {
                      setCommandView(null);
                    } else {
                      setCommandView("escape");
                      logMessage(`${heroName || "ゆうしゃ"}は にげようとした！`);
                    }
                  }}
                >
                  <span>にげる</span>
                  <small className="dq-toggle-mark">{commandView === "escape" ? "▼" : "▶"}</small>
                </button>
              </li>
            </ul>
          </div>

          {/* サブメニューカード（コマンドボックスの右隣に開く） */}
          {commandView === "magic" && (
            <div className="dq-submenu-card" data-glow={glowTarget === "submenu" ? true : undefined} role="group" aria-label="まほうリスト">
              <p className="dq-submenu-title">まほう</p>
              <ul className="dq-submenu">
                <li>
                  <button
                    type="button"
                    data-active={canTricom}
                    disabled={!canTricom}
                    title={!canTricom ? "「たたかう」で新しい画像を えらぶと使える" : undefined}
                    onClick={() => castTricom()}
                  >
                    <span>トリコム</span><small>画像を 仲間に</small>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    data-active={selectedMagic === "resize"}
                    disabled={!canResize}
                    title={!canResize ? "まず トリコムで取り込んでから" : undefined}
                    onClick={() => selectMagicAndScroll("resize")}
                  >
                    <span>サイチェン</span><small>サイズ変更</small>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    data-active={selectedMagic === "format"}
                    disabled={!canFormat}
                    title={!canFormat ? "まず トリコムで取り込んでから" : undefined}
                    onClick={() => selectMagicAndScroll("format")}
                  >
                    <span>フォマカル</span><small>形式変換・圧縮</small>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    data-active={selectedMagic === "transparent"}
                    disabled={!canTransparent}
                    title={!canTransparent ? "まず トリコムで取り込んでから" : undefined}
                    onClick={() => selectMagicAndScroll("transparent")}
                  >
                    <span>スケル</span><small>背景透過</small>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    data-active={selectedMagic === "hokante"}
                    disabled={!canHokante}
                    title={!canHokante ? "まず トリコムで取り込んでから" : undefined}
                    onClick={() => selectMagicAndScroll("hokante")}
                  >
                    <span>ホカンテ</span><small>一時ほぞん</small>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    data-active={selectedMagic === "polpunte"}
                    disabled={!canPolpunte}
                    title={!canPolpunte ? "まず トリコムで取り込んでから" : undefined}
                    onClick={() => selectMagicAndScroll("polpunte")}
                  >
                    <span>ポルプンテ</span><small>謎の変化</small>
                  </button>
                </li>
              </ul>
            </div>
          )}

          {commandView === "save" && (
            <div className="dq-submenu-card" data-glow={glowTarget === "submenu" ? true : undefined} role="group" aria-label="ほぞんメニュー">
              <p className="dq-submenu-title">ぼうぎょ</p>
              <ul className="dq-submenu">
                <li>
                  <button
                    type="button"
                    disabled={!completed.length}
                    onClick={() => void downloadZip()}
                  >
                    <span>ZIPで まとめてほぞん</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    disabled={!completed.length}
                    onClick={saveAllIndividually}
                  >
                    <span>1まいずつ ほぞん</span>
                  </button>
                </li>
                {!completed.length && (
                  <li className="dq-submenu-empty">まず まほうを となえよ。</li>
                )}
              </ul>
            </div>
          )}

          {commandView === "escape" && (
            <div className="dq-submenu-card" data-glow={glowTarget === "submenu" ? true : undefined} role="group" aria-label="にげる確認">
              <p className="dq-submenu-title">にげる</p>
              <ul className="dq-submenu">
                {hasUnsavedResults && (
                  <li className="dq-submenu-warn">まだ ほぞんしていない 画像が ある！</li>
                )}
                <li>
                  <button type="button" onClick={exitAdventure}>
                    <span>はい</span>
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => setCommandView(null)}>
                    <span>いいえ</span>
                  </button>
                </li>
              </ul>
            </div>
          )}

          <div className="dq-enemy-cards" aria-live="polite" aria-label="敵情報">
            {items.length > 0 || pendingItems.length > 0 ? (
              enemyEntries.slice(0, 4).map((enemy) => (
                <article className="dq-enemy-card" key={enemy.id} data-kind={enemy.kind}>
                  <p className="dq-enemy-card-name">{enemy.label}</p>
                  <p className="dq-enemy-card-count">- {enemy.count}ひき</p>
                </article>
              ))
            ) : (
              <article className="dq-enemy-card dq-enemy-card-empty">
                <p>てきは まだ あらわれていない。</p>
              </article>
            )}
          </div>
        </div>

        {/* DQ風メッセージログ（行動と次の誘導が時系列で流れる）／クリックでスキップ */}
        <div
          className="dq-log"
          role="log"
          aria-live="polite"
          aria-label="バトルログ（クリックで早送り）"
          onClick={skipTyping}
        >
          <button
            type="button"
            className="dq-mute"
            aria-label={isSoundMuted ? "効果音を ONにする" : "効果音を OFFにする"}
            onClick={(event) => {
              event.stopPropagation();
              toggleSound();
            }}
            title={isSoundMuted ? "効果音: OFF" : "効果音: ON"}
          >
            {isSoundMuted ? "♪×" : "♪"}
          </button>
          {messageLog.slice(-4).map((msg, index, arr) => {
            const isLatest = index === arr.length - 1;
            const text = isLatest ? msg.slice(0, typedIndex) : msg;
            const fullyTyped = !isLatest || typedIndex >= msg.length;
            return (
              <p
                key={`${messageLog.length - arr.length + index}`}
                data-latest={isLatest && fullyTyped ? true : undefined}
                data-typing={isLatest && !fullyTyped ? true : undefined}
              >
                {text}
                {isLatest && !fullyTyped && <span className="dq-typing-caret" aria-hidden="true">▌</span>}
              </p>
            );
          })}
        </div>
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        multiple
        onChange={(event) => event.target.files && void addFiles(event.target.files)}
      />


      {commandView === "magic" && selectedMagic === "hokante" && (
        <div ref={magicConfigRef} className="game-window p-4 sm:p-6" data-glow={glowTarget === "config" ? true : undefined}>
          {/* ── 現在の画像一覧（選択してかばんへ） ── */}
          {items.length > 0 && (<>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="game-window-title !mb-0"><PixelIcon name="bag" /> ホカンテ（一時ほぞんの魔法）：{items.length}枚</h2>
              <div className="flex gap-2">
                <button
                  className="pixel-button !min-h-10 !py-1.5 text-xs"
                  type="button"
                  onClick={() => {
                    const allIds = items.map((i) => i.id);
                    const allSelected = allIds.every((id) => hokanteSelectedIds.includes(id));
                    setHokanteSelectedIds(allSelected ? [] : allIds);
                  }}
                >
                  {items.every((i) => hokanteSelectedIds.includes(i.id)) ? "すべて解除" : "すべて選択"}
                </button>
                <button className="pixel-button danger !min-h-10 !py-1.5 text-xs" type="button" onClick={clearAll}>外す</button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((item) => {
                const isSelected = hokanteSelectedIds.includes(item.id);
                return (
                  <article
                    key={item.id}
                    className="quest-card"
                    data-selected={isSelected || undefined}
                    style={{ cursor: "pointer", outline: isSelected ? "2px solid #facc15" : undefined }}
                    onClick={() =>
                      setHokanteSelectedIds((ids) =>
                        ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id]
                      )
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.resultUrl ?? item.previewUrl} alt={`${item.file.name}のプレビュー`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white" title={item.file.name}>{item.file.name}</p>
                      <p className="mt-1 text-xs text-slate-300">{item.width} × {item.height}px ／ {formatBytes(item.file.size)}</p>
                      {item.result && (
                        <p className="mt-1 text-xs text-green-300">→ れんきん済み {formatBytes(item.result.size)}</p>
                      )}
                      {item.backgroundRemoved && <p className="mt-1 flex items-center gap-1 text-xs text-cyan-300"><PixelIcon name="flask" className="inline-icon" />背景透過済み</p>}
                      {item.error && <p className="mt-1 text-xs text-red-300">{item.error}</p>}
                      <p className="mt-2 text-xs text-yellow-300">{isSelected ? "✓ えらばれた" : "タップして えらぶ"}</p>
                    </div>
                  </article>
                );
              })}
            </div>
            <button
              className="pixel-button primary mt-4 w-full text-base"
              type="button"
              disabled={!hokanteSelectedIds.length}
              onClick={castHokante}
            >
              <PixelIcon name="chest" className="button-icon" />
              {hokanteSelectedIds.length
                ? `ホカンテをとなえる（${hokanteSelectedIds.length}まい → かばんへ）`
                : "画像を えらんでから となえる"}
            </button>
            <p className="mt-2 text-xs text-slate-400">かばんに しまった画像は アプリを使っている間 ずっと のこります。いつでも とりだせます。</p>
          </>)}

          {/* ── ほかんてのかばん（スタッシュ） ── */}
          {stashedItems.length > 0 && (
            <div className="mt-6 border-t border-[#5358ac] pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="game-window-title !mb-0 text-base"><PixelIcon name="chest" /> ほかんてのかばん：{stashedItems.length}まい</h3>
                <button className="pixel-button danger !min-h-10 !py-1.5 text-xs" type="button" onClick={clearStash}>かばんを 空にする</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {stashedItems.map((item) => (
                  <article className="quest-card" key={item.id} style={{ opacity: 0.85 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.resultUrl ?? item.previewUrl} alt={`${item.file.name}のプレビュー`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white" title={item.file.name}>{item.file.name}</p>
                      <p className="mt-1 text-xs text-slate-300">{item.width} × {item.height}px</p>
                      {item.result && <p className="mt-1 text-xs text-green-300">れんきん済み</p>}
                      <button
                        className="mt-2 text-xs text-cyan-300 underline underline-offset-4"
                        type="button"
                        onClick={() => retrieveFromStash(item.id)}
                      >
                        とりだす
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {items.length === 0 && stashedItems.length === 0 && (
            <p className="text-sm text-slate-300">まず「トリコム」で 画像を なかまにせよ。</p>
          )}
        </div>
      )}

      {commandView === "magic" && (selectedMagic === "resize" || selectedMagic === "format" || selectedMagic === "transparent") && <div ref={magicConfigRef} className="game-window p-4 sm:p-6" data-glow={glowTarget === "config" ? true : undefined}>
        <div className="grid gap-5">
          {selectedMagic === "resize" && <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-bold text-white">サイチェン（サイズ変更の魔法）</legend>
            {items.length > 0 && (
              <div className="current-size-panel">
                <p className="current-size-label">いまの サイズ</p>
                {items.length === 1 ? (
                  <p className="current-size-value">{items[0].width} × {items[0].height} px</p>
                ) : (
                  <ul className="current-size-list">
                    {items.slice(0, 5).map((item) => (
                      <li key={item.id}>
                        <span className="current-size-name" title={item.file.name}>{enemyLabel(item.file.name)}</span>
                        <span className="current-size-value">{item.width} × {item.height} px</span>
                      </li>
                    ))}
                    {items.length > 5 && (
                      <li className="current-size-more">ほか {items.length - 5} まい</li>
                    )}
                  </ul>
                )}
              </div>
            )}
            <p className="text-xs text-cyan-300">↓ あたらしい サイズ</p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <label className="text-xs text-slate-300">幅（px）<input className="field mt-1" min="1" max="16384" type="number" value={width} onChange={(event) => updateWidth(Number(event.target.value))} /></label>
              <span className="pb-3 text-slate-400">×</span>
              <label className="text-xs text-slate-300">高さ（px）<input className="field mt-1" disabled={keepRatio} min="1" max="16384" type="number" value={height} onChange={(event) => updateHeight(Number(event.target.value))} /></label>
            </div>
            <label className="flex min-h-11 items-center gap-3 border-2 border-[#5358ac] bg-black/30 px-3 py-2 text-sm">
              <input className="h-5 w-5 accent-yellow-300" type="checkbox" checked={keepRatio} onChange={(event) => setKeepRatio(event.target.checked)} />
              縦横比を まもる
            </label>
          </fieldset>}

          {selectedMagic === "format" && <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-bold text-white">フォマカル（形式変換と圧縮の魔法）</legend>
            <label className="block text-xs text-slate-300">出力形式
              <select className="field mt-1" value={format} onChange={(event) => setFormat(event.target.value as OutputFormat)}>
                <option value="image/webp">WebP（おすすめ）</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/png">PNG</option>
              </select>
            </label>
            <div className="quality-panel" aria-disabled={format === "image/png"}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">画質：{qualityInfo.label}</p>
                  <p className="mt-1 text-xs text-slate-300">{qualityInfo.note}</p>
                </div>
                <output className="quality-score" htmlFor="quality-slider" aria-label={`画質 ${quality}パーセント`}>{quality}%</output>
              </div>
              <div className="quality-meter mt-3" role="meter" aria-label={`画質 ${qualityInfo.label}`} aria-valuemin={20} aria-valuemax={100} aria-valuenow={quality}>
                <span style={{ width: `${((quality - 20) / 80) * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>軽い・低画質</span><span>重い・高画質</span></div>
              <input id="quality-slider" aria-label="画質" className="mt-3 w-full accent-yellow-300 disabled:opacity-40" disabled={format === "image/png"} min="20" max="100" type="range" value={quality} onChange={(event) => setQuality(Number(event.target.value))} />
              <div className="mt-3 grid grid-cols-4 gap-2" aria-label="画質プリセット">
                {[{ value: 40, label: "最軽量" }, { value: 65, label: "軽量" }, { value: 82, label: "標準" }, { value: 92, label: "高画質" }].map((preset) => (
                  <button className="quality-preset" data-active={quality === preset.value} disabled={format === "image/png"} key={preset.value} type="button" onClick={() => setQuality(preset.value)}>{preset.label}</button>
                ))}
              </div>
              <div className="size-estimate mt-3" aria-live="polite">
                <span>できあがり容量の目安（合計）</span>
                <strong>
                  {estimatedTotalBytes
                    ? `約 ${formatBytes(estimatedTotalBytes * 0.65)}〜${formatBytes(estimatedTotalBytes * 1.35)}`
                    : "画像を選ぶと表示されます"}
                </strong>
                <small>画像の色や細かさによって実際の容量は変わります。</small>
              </div>
              {format === "image/png" && <p className="mt-3 text-xs text-cyan-300">PNGは画質を下げずに保存します。</p>}
            </div>
          </fieldset>}

          {selectedMagic === "transparent" && <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-bold text-white">スケル（単色背景を透明にする魔法）</legend>
            <div className="background-settings">
              <div className="flex items-center justify-between gap-3 text-sm"><span>透過する色の範囲</span><strong className="text-cyan-300">{backgroundSensitivityStatus(backgroundSensitivity)}</strong></div>
              <input aria-label="背景透過の感度" className="mt-3 w-full accent-cyan-300" min="5" max="90" type="range" value={backgroundSensitivity} onChange={(event) => setBackgroundSensitivity(Number(event.target.value))} />
              <p className="mt-2 text-xs leading-5 text-slate-300">四隅から背景色を判定します。背景が残る場合は「広め」、被写体まで消える場合は「厳密」へ調整してください。出力はPNGになります。</p>
            </div>
          </fieldset>}
        </div>
        <button className="pixel-button primary mt-5 w-full text-base sm:text-lg" type="button" disabled={!items.length || isProcessing} onClick={() => void forgeAll()}>
          {isProcessing && <PixelIcon name="flask" className="button-icon" />}
          {isProcessing ? "れんきん中…" : `${selectedMagic === "resize" ? "サイチェン" : selectedMagic === "format" ? "フォマカル" : "スケル"}を となえる`}
        </button>
      </div>}

      {commandView === "magic" && selectedMagic === "polpunte" && <div ref={magicConfigRef} className="game-window mystery-window p-4 sm:p-6" data-glow={glowTarget === "config" ? true : undefined}>
        <h2 className="game-window-title mystery-title"><PixelIcon name="orb" /> ポルプンテ（未知の変化を呼ぶ謎の魔法）</h2>
        <p className="text-sm leading-7 text-slate-200">
          アイデアが煮詰まった時、添付画像を予想不能な別世界へ導く「復活の呪文」を生み出します。
        </p>
        <button
          className="pixel-button mystery-button mt-4 w-full"
          type="button"
          onClick={() => {
            if (!tryConsumeMp("polpunte")) return;
            playMagicSound();
            setRevivalSpell(createRevivalSpell());
            setCopyLabel("復活の呪文を コピー");
            logMessage(`${heroName || "ゆうしゃ"}は ポルプンテを となえた！`);
            endTurn();
          }}
        >
          ポルプンテを となえる
        </button>
        {revivalSpell && (
          <div className="revival-spell mt-4">
            <p className="revival-spell-label">復活の呪文</p>
            <textarea aria-label="生成AI用の復活の呪文" readOnly rows={7} value={revivalSpell} />
            <button className="pixel-button mt-3 w-full text-xs" type="button" onClick={() => void copyRevivalSpell()}>
              {copyLabel}
            </button>
            <p className="mt-3 text-xs leading-5 text-slate-300">
              元画像を生成AIに添付し、この英語の呪文を貼り付けて実行してください。
            </p>
          </div>
        )}
      </div>}

      {exitNotice && (
        <div className="dialog-backdrop" role="presentation">
          <div className="warning-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title">
            <h2 id="exit-title">冒険を終了しました</h2>
            <p>ブラウザの制限で自動的に閉じられないため、このタブを閉じてください。</p>
            <button className="pixel-button mt-4 w-full" type="button" onClick={() => setExitNotice(false)}>冒険に もどる</button>
          </div>
        </div>
      )}

      {damageFlash && <div className="damage-flash" aria-hidden="true" />}

      {showGameOver && (
        <div className="dialog-backdrop" role="presentation">
          <div className="warning-dialog game-over-dialog" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
            <h2 id="gameover-title">ゲームオーバー</h2>
            <p className="game-over-line">{heroName || "ゆうしゃ"}は ちからつきてしまった…</p>
            <p className="game-over-sub">（画像データは 一時的に 保存されています）</p>
            <button className="pixel-button primary mt-5 w-full" type="button" onClick={revive}>
              ふっかつする
            </button>
          </div>
        </div>
      )}

      {showGodPassword && (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="warning-dialog god-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="god-title"
            onSubmit={(event) => {
              event.preventDefault();
              handlePasswordSubmit();
            }}
          >
            <h2 id="god-title">⛅ 神の こえ ⛅</h2>
            <p className="god-line">「ゆうしゃよ… MPが つきたか…」</p>
            <p className="god-line">「パスワードを となえれば MPを 完全回復してやろう」</p>
            <p className="god-hint">💡 ヒント： ファミコンが 発売された 西暦（4ケタの数字）</p>
            <label className="block text-xs text-slate-300 mt-2">
              パスワード
              <input
                autoFocus
                className="field mt-2"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={passwordInput}
                onChange={(event) => {
                  setPasswordInput(event.target.value);
                  setPasswordError("");
                }}
                placeholder="????"
              />
            </label>
            {passwordError && <p className="god-error">{passwordError}</p>}
            <div className="grid gap-3 sm:grid-cols-2 mt-4">
              <button type="submit" className="pixel-button primary" disabled={!passwordInput.trim()}>
                こたえる
              </button>
              <button
                type="button"
                className="pixel-button"
                onClick={() => {
                  setShowGodPassword(false);
                  setPasswordInput("");
                  setPasswordError("");
                }}
              >
                あきらめる
              </button>
            </div>
          </form>
        </div>
      )}

      {duplicateWarningFiles.length > 0 && (
        <div className="dialog-backdrop" role="presentation">
          <div className="warning-dialog" role="dialog" aria-modal="true" aria-labelledby="dup-title">
            <h2 id="dup-title">⚠ すでに れんきん済みだ！</h2>
            <p>以下の画像は すでに れんきんされている。<br />おなじ画像を もういちど えらぶことは できない。</p>
            <ul className="mt-3 space-y-1 text-sm text-yellow-300">
              {duplicateWarningFiles.map((name) => (
                <li key={name} className="truncate">・{name}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-300">べつの画像を えらぶか、「すべて外す」で リセットしてから えらびなおせ。</p>
            <button
              className="pixel-button primary mt-4 w-full"
              type="button"
              onClick={() => setDuplicateWarningFiles([])}
            >
              わかった
            </button>
          </div>
        </div>
      )}

      {showSplash && (
        <div className="splash-backdrop" role="presentation" aria-label="タイトル画面">
          <div className="splash-inner">
            <p className="pixel-kicker splash-kicker">ブラウザ だけで できる！</p>
            <div className="logo-title splash-title">
              <span>GAZO</span>
              <strong>RENKIN</strong>
            </div>
            <p className="splash-sub">画像を 軽く・美しく 変える 冒険</p>
            <button
              className="splash-start-btn"
              type="button"
              onClick={() => {
                ensureAudioContext();
                setShowSplash(false);
              }}
            >
              ▶ 冒険をはじめる
            </button>
          </div>
        </div>
      )}

      {showNameModal && (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="warning-dialog name-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hero-name-title"
            onSubmit={(event) => {
              event.preventDefault();
              confirmHeroName();
            }}
          >
            <h2 id="hero-name-title">なまえを いれてください</h2>
            <p>これから 画像の冒険が はじまる。<br />ゆうしゃの なまえは？</p>
            <label className="block text-xs text-slate-300">
              なまえ（ぜんかく {HERO_NAME_MAX}もじまで）
              <input
                autoFocus
                className="field mt-2"
                maxLength={HERO_NAME_MAX}
                onChange={(event) => setPendingHeroName(event.target.value)}
                placeholder="ゆうしゃ"
                type="text"
                value={pendingHeroName}
              />
            </label>
            <button
              className="pixel-button primary mt-4 w-full"
              disabled={!pendingHeroName.trim()}
              type="submit"
            >
              これで よい
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
