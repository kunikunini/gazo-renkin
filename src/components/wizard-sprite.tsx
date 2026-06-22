type WizardSpriteProps = {
  size?: number;
  className?: string;
  label?: string;
};

/**
 * ピクセル風の魔法使いキャラクター（添付画像をモチーフ）
 * - ピンクのローブ
 * - 紫の魔法使い帽（金の縁取り）
 * - 金の杖と青いオーブ
 */
export function WizardSprite({ size = 96, className = "", label }: WizardSpriteProps) {
  return (
    <svg
      aria-label={label ?? "魔法使い"}
      role="img"
      width={size}
      height={size}
      viewBox="0 0 80 88"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      className={className}
      style={{ imageRendering: "pixelated" }}
    >
      {/* Staff pole */}
      <rect x="7" y="22" width="3" height="58" fill="#c2861a" stroke="#1a0a2a" strokeWidth="1" />
      <rect x="7" y="32" width="3" height="2" fill="#7a4f0a" />
      <rect x="7" y="50" width="3" height="2" fill="#7a4f0a" />
      <rect x="7" y="68" width="3" height="2" fill="#7a4f0a" />
      {/* Staff orb */}
      <circle cx="8.5" cy="16" r="6.5" fill="#3a6ee0" stroke="#e2b13a" strokeWidth="2" />
      <circle cx="6.5" cy="14" r="1.6" fill="#cfe1ff" opacity="0.85" />

      {/* Hat (purple triangle) */}
      <polygon points="40,4 26,28 56,28" fill="#5a2c8a" stroke="#1a0a2a" strokeWidth="2" />
      {/* Hat brim */}
      <rect x="22" y="26" width="38" height="6" fill="#5a2c8a" stroke="#1a0a2a" strokeWidth="2" />
      {/* Gold band */}
      <rect x="22" y="27" width="38" height="3" fill="#e2b13a" />

      {/* Hood (pink) */}
      <ellipse cx="40" cy="50" rx="22" ry="18" fill="#e98ab3" stroke="#1a0a2a" strokeWidth="2" />
      {/* Inner hood ring */}
      <ellipse cx="40" cy="48" rx="17" ry="14" fill="#f4b3cd" />

      {/* Face (cream) */}
      <ellipse cx="40" cy="48" rx="13" ry="13" fill="#fceec8" stroke="#1a0a2a" strokeWidth="2" />

      {/* Green cheeks */}
      <rect x="27" y="49" width="6" height="3" fill="#9be39c" />
      <rect x="47" y="49" width="6" height="3" fill="#9be39c" />

      {/* Eyes (white sclera + pupil) */}
      <ellipse cx="34" cy="46" rx="3.2" ry="3.6" fill="#ffffff" stroke="#0a0a0a" strokeWidth="1.5" />
      <ellipse cx="46" cy="46" rx="3.2" ry="3.6" fill="#ffffff" stroke="#0a0a0a" strokeWidth="1.5" />
      <circle cx="34.5" cy="47" r="1.6" fill="#0a0a0a" />
      <circle cx="46.5" cy="47" r="1.6" fill="#0a0a0a" />

      {/* Nose */}
      <circle cx="40" cy="53" r="1.2" fill="#0a0a0a" />
      {/* Tongue */}
      <ellipse cx="40" cy="56" rx="1.8" ry="2.4" fill="#c92b3d" />

      {/* Body (pink robe) */}
      <path
        d="M 18 64 L 22 84 L 58 84 L 62 64 Q 50 62 40 62 Q 30 62 18 64 Z"
        fill="#e98ab3"
        stroke="#1a0a2a"
        strokeWidth="2"
      />

      {/* Purple cape collar */}
      <path
        d="M 22 64 L 30 72 L 50 72 L 58 64 Q 40 66 22 64 Z"
        fill="#5a2c8a"
        stroke="#1a0a2a"
        strokeWidth="2"
      />
      <path
        d="M 22 64 L 30 72 L 50 72 L 58 64"
        fill="none"
        stroke="#e2b13a"
        strokeWidth="1.5"
      />

      {/* Brooch (blue gem with gold frame) */}
      <circle cx="40" cy="71" r="3.2" fill="#3a6ee0" stroke="#e2b13a" strokeWidth="1.5" />
      <circle cx="39" cy="70" r="0.8" fill="#cfe1ff" opacity="0.85" />

      {/* Right hand */}
      <circle cx="60" cy="78" r="4" fill="#e98ab3" stroke="#1a0a2a" strokeWidth="2" />
      {/* Left hand (gripping staff) */}
      <circle cx="14" cy="62" r="4" fill="#e98ab3" stroke="#1a0a2a" strokeWidth="2" />

      {/* Feet */}
      <ellipse cx="32" cy="86" rx="5" ry="2.4" fill="#6b3a17" stroke="#1a0a2a" strokeWidth="1.5" />
      <ellipse cx="48" cy="86" rx="5" ry="2.4" fill="#6b3a17" stroke="#1a0a2a" strokeWidth="1.5" />
    </svg>
  );
}
