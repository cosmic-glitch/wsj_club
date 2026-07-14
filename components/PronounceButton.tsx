"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small "hear it" button next to a vocab word or concept name on the handout.
 *
 * Two modes:
 *   • `audioSrc` given  → play a pre-generated OpenAI-TTS mp3 (premium, natural
 *     US-English voice; no login, no runtime cost — it's a static asset).
 *   • no `audioSrc`     → the browser's built-in Web Speech API (`speechSynthesis`)
 *     with a US-English voice (free, but robotic and device-dependent).
 * If the mp3 fails to load, it falls back to the browser voice.
 *
 * Like TodayTag, it renders nothing on the server and first client paint, then
 * pops in after mount — no hydration mismatch, and a browser that supports
 * neither path simply shows no button.
 */
export default function PronounceButton({
  text,
  label,
  audioSrc,
  className = "",
}: {
  text: string; // the term actually spoken aloud (the word / concept name)
  label?: string; // for the aria-label; defaults to `text`
  audioSrc?: string; // pre-generated mp3 URL; when set, plays that instead of browser speech
  className?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const hasSpeech = () =>
    typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (typeof window === "undefined") return;
    // An mp3 button always works; the browser-speech button needs speechSynthesis.
    setSupported(audioSrc ? true : hasSpeech());
    if (hasSpeech()) {
      const synth = window.speechSynthesis;
      const load = () => {
        voicesRef.current = synth.getVoices();
      };
      load();
      synth.addEventListener("voiceschanged", load);
      return () => {
        synth.removeEventListener("voiceschanged", load);
        synth.cancel();
      };
    }
  }, [audioSrc]);

  // Stop any playback when the button unmounts.
  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (hasSpeech()) window.speechSynthesis.cancel();
    },
    [],
  );

  if (!supported) return null;

  function pickVoice(): SpeechSynthesisVoice | undefined {
    const voices = voicesRef.current;
    if (!voices.length) return undefined;
    const enUs = voices.filter((v) => v.lang === "en-US" || v.lang === "en_US");
    const pool = enUs.length ? enUs : voices.filter((v) => v.lang?.startsWith("en"));
    return pool.find((v) => v.default) ?? pool[0];
  }

  function speakBrowser() {
    if (!hasSpeech()) return;
    const synth = window.speechSynthesis;
    synth.cancel(); // stop anything already in flight
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9; // a touch slower than default — clearer for a single word
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
  }

  function playMp3() {
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(audioSrc);
      audio.onplaying = () => {
        setLoading(false);
        setSpeaking(true);
      };
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => {
        // mp3 missing/failed — fall back to the browser voice.
        setLoading(false);
        setSpeaking(false);
        audioRef.current = null;
        speakBrowser();
      };
      audioRef.current = audio;
    }
    setLoading(true);
    audio.currentTime = 0;
    audio.play().catch(() => {
      setLoading(false);
      speakBrowser();
    });
  }

  function handleClick() {
    if (audioSrc) playMp3();
    else speakBrowser();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-busy={loading}
      aria-label={`Hear "${label ?? text}" pronounced`}
      title="Hear it"
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center border-2 border-[#0a0a0a] transition active:translate-y-px disabled:cursor-wait ${
        speaking || loading ? "bg-[#ffe600]" : "bg-white hover:bg-[#ffe600]"
      } ${className}`}
    >
      {/* A small speaker glyph in ink; pulses while loading/speaking. */}
      <svg
        viewBox="0 0 24 24"
        className={`h-3.5 w-3.5 text-[#0a0a0a] ${loading ? "animate-pulse" : ""}`}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M11 5 6 9H3v6h3l5 4V5z" />
        <path
          d="M15.5 8.5a4 4 0 0 1 0 7M18 6a7 7 0 0 1 0 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
