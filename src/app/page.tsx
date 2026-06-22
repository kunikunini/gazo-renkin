import { ImageForge } from "@/components/image-forge";
import Image from "next/image";

export default function Home() {
  return (
    <main id="main-content" className="min-h-screen overflow-hidden">
      <a className="skip-link" href="#forge">
        れんきん所へ移動
      </a>

      <div className="stars" aria-hidden="true" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
        <header className="hero-enter mb-8 text-center sm:mb-10">
          <div className="hero-orb" aria-hidden="true">
            <Image src="/assets/icons/orb.png" alt="" width={112} height={112} priority />
          </div>
          <p className="pixel-kicker">IMAGE ALCHEMY TOOL</p>
          <h1 className="logo-title" aria-label="GAZO RENKIN">
            <span>GAZO</span>
            <strong>RENKIN</strong>
          </h1>
          <p className="hero-tagline mt-6 text-sm tracking-[0.18em] text-slate-300 sm:text-base">
            画像を かるく美しく れんきんせよ
          </p>
        </header>

        <ImageForge />

        <footer className="mt-8 border-2 border-white/40 bg-black/75 px-5 py-3 text-center text-xs leading-7 text-slate-100" style={{ boxShadow: "0 0 0 2px rgba(0,0,0,0.6)" }}>
          🔒 画像は このブラウザの中だけで処理され、サーバーには送信されません。
          <br />
          冒険がおわると、画像データはブラウザから消えます。
        </footer>
      </div>
    </main>
  );
}
