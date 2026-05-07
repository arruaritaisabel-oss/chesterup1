import { useEffect, useRef, useState, useCallback } from "react";
import {
  Clock,
  Bell,
  BellSlash,
  VideoCamera,
  VideoCameraSlash,
  Dog,
  PawPrint,
  Sparkle,
  Waveform,
  Sun,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";

// === Constants ===
const ALARM_HOUR = 5; // 5 AM Argentina time (fixed)
const ALARM_MINUTE = 0;
const TIMEZONE = "America/Argentina/Buenos_Aires";
const ALARM_PHRASE =
  "¡Chester se despertó! Hay que sacarlo al baño. Despertate, Chester te necesita.";
const STORAGE_KEY = "chester_alarm_state_v1";
const MOTION_COOLDOWN_MS = 60_000; // 1 min between motion-triggered alarms
const MOTION_NIGHT_START_HOUR = 4; // motion alarm only between 04:00 and 07:00 ARG
const MOTION_NIGHT_END_HOUR = 7;

// === Helpers ===
function getArgentinaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE,
    hour12: false,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return parts;
}

function getArgentinaHourMinute(date = new Date()) {
  const parts = getArgentinaParts(date);
  return {
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

function speak(text) {
  if (!("speechSynthesis" in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-AR";
    u.rate = 0.95;
    u.pitch = 1.05;
    u.volume = 1;
    // Try to pick a Spanish voice if available
    const voices = window.speechSynthesis.getVoices();
    const esVoice =
      voices.find((v) => /es[-_]AR/i.test(v.lang)) ||
      voices.find((v) => /es[-_]MX/i.test(v.lang)) ||
      voices.find((v) => /es[-_]ES/i.test(v.lang)) ||
      voices.find((v) => v.lang?.toLowerCase().startsWith("es"));
    if (esVoice) u.voice = esVoice;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    console.error("TTS error", e);
    return false;
  }
}

function formatLogTime(iso) {
  try {
    const fmt = new Intl.DateTimeFormat("es-AR", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
    return fmt.format(new Date(iso));
  } catch {
    return iso;
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (err) {
    // localStorage may fail in private mode or when quota is exceeded.
    // Non-fatal: the app keeps working in-memory for the current session.
    console.warn("Chester Alarm: no se pudo guardar el estado en localStorage", err);
  }
}

export default function App() {
  // Persisted prefs
  const init = loadState() || {};
  const [armed, setArmed] = useState(init.armed ?? true);
  const [motionEnabled, setMotionEnabled] = useState(
    init.motionEnabled ?? false,
  );
  const [sensitivity, setSensitivity] = useState(init.sensitivity ?? 25); // 1-100
  const [events, setEvents] = useState(init.events ?? []);

  // Live state
  const [now, setNow] = useState(new Date());
  const [cameraStatus, setCameraStatus] = useState("off"); // off | requesting | running | error
  const [cameraError, setCameraError] = useState("");
  const [motionLevel, setMotionLevel] = useState(0); // current frame diff %
  const [motionDetected, setMotionDetected] = useState(false);
  const [alarmRinging, setAlarmRinging] = useState(false);

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const prevFrameRef = useRef(null);
  const motionRafRef = useRef(null);
  const lastMotionAlarmRef = useRef(0);
  const lastDailyAlarmDateRef = useRef(init.lastDailyAlarmDate || "");

  // Persist prefs whenever they change
  useEffect(() => {
    saveState({
      armed,
      motionEnabled,
      sensitivity,
      events,
      lastDailyAlarmDate: lastDailyAlarmDateRef.current,
    });
  }, [armed, motionEnabled, sensitivity, events]);

  // Tick clock every second
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Pre-load voices for some browsers
  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  const addEvent = useCallback((type, message) => {
    setEvents((prev) => {
      const next = [
        { id: Date.now() + Math.random(), type, message, ts: new Date().toISOString() },
        ...prev,
      ].slice(0, 25);
      return next;
    });
  }, []);

  const triggerAlarm = useCallback(
    (reason) => {
      setAlarmRinging(true);
      const ok = speak(ALARM_PHRASE);
      addEvent(
        reason === "scheduled" ? "alarm" : reason === "motion" ? "motion" : "test",
        reason === "scheduled"
          ? "Alarma programada de las 05:00 (ARG)"
          : reason === "motion"
            ? "Movimiento detectado: alarma activada"
            : "Prueba de voz manual",
      );
      // Stop "ringing" visual after speech ends or 12s fallback
      const stop = () => setAlarmRinging(false);
      if ("speechSynthesis" in window) {
        const checker = setInterval(() => {
          if (!window.speechSynthesis.speaking) {
            clearInterval(checker);
            stop();
          }
        }, 500);
        setTimeout(() => {
          clearInterval(checker);
          stop();
        }, 15000);
      } else {
        setTimeout(stop, 4000);
      }
      return ok;
    },
    [addEvent],
  );

  // Daily 5:00 AM scheduler — checks every second, fires once per day
  useEffect(() => {
    const arg = getArgentinaHourMinute(now);
    const todayKey = (() => {
      const p = getArgentinaParts(now);
      return `${p.year}-${p.month}-${p.day}`;
    })();

    if (
      armed &&
      arg.hour === ALARM_HOUR &&
      arg.minute === ALARM_MINUTE &&
      lastDailyAlarmDateRef.current !== todayKey
    ) {
      lastDailyAlarmDateRef.current = todayKey;
      saveState({
        armed,
        motionEnabled,
        sensitivity,
        events,
        lastDailyAlarmDate: todayKey,
      });
      triggerAlarm("scheduled");
    }
  }, [now, armed, motionEnabled, sensitivity, events, triggerAlarm]);

  // === Camera handling ===
  const startCamera = useCallback(async () => {
    setCameraError("");
    setCameraStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 480, height: 360 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraStatus("running");
      addEvent("camera", "Cámara activada para detección de movimiento");
    } catch (e) {
      console.error(e);
      setCameraStatus("error");
      setCameraError(e?.message || "No se pudo acceder a la cámara");
      setMotionEnabled(false);
      addEvent("error", "Error al activar la cámara: " + (e?.message || "permiso denegado"));
    }
  }, [addEvent]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    prevFrameRef.current = null;
    setMotionLevel(0);
    setMotionDetected(false);
    setCameraStatus("off");
  }, []);

  useEffect(() => {
    if (motionEnabled && cameraStatus === "off") {
      startCamera();
    }
    if (!motionEnabled && cameraStatus !== "off") {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (motionRafRef.current) cancelAnimationFrame(motionRafRef.current);
    };
  }, []);

  // === Motion detection loop ===
  useEffect(() => {
    if (cameraStatus !== "running") return;
    let cancelled = false;

    const loop = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        motionRafRef.current = requestAnimationFrame(loop);
        return;
      }
      const w = 64;
      const h = 48;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const frame = ctx.getImageData(0, 0, w, h);
      const prev = prevFrameRef.current;
      let diffPct = 0;
      if (prev) {
        let diffPixels = 0;
        const thresh = 30; // per-pixel intensity diff threshold
        const len = frame.data.length;
        for (let i = 0; i < len; i += 4) {
          const dr = Math.abs(frame.data[i] - prev.data[i]);
          const dg = Math.abs(frame.data[i + 1] - prev.data[i + 1]);
          const db = Math.abs(frame.data[i + 2] - prev.data[i + 2]);
          if (dr + dg + db > thresh * 3) diffPixels++;
        }
        diffPct = (diffPixels / (w * h)) * 100;
      }
      prevFrameRef.current = frame;
      setMotionLevel(diffPct);

      // Trigger threshold = 100 - sensitivity (higher sensitivity => lower threshold)
      const triggerThreshold = Math.max(1.5, (100 - sensitivity) / 6 + 0.5);
      if (diffPct > triggerThreshold) {
        setMotionDetected(true);
        const nowMs = Date.now();
        const arg = getArgentinaHourMinute(new Date());
        const inNightWindow =
          arg.hour >= MOTION_NIGHT_START_HOUR && arg.hour < MOTION_NIGHT_END_HOUR;
        if (
          armed &&
          inNightWindow &&
          nowMs - lastMotionAlarmRef.current > MOTION_COOLDOWN_MS
        ) {
          lastMotionAlarmRef.current = nowMs;
          triggerAlarm("motion");
        }
        setTimeout(() => setMotionDetected(false), 1500);
      }

      motionRafRef.current = requestAnimationFrame(loop);
    };

    motionRafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (motionRafRef.current) cancelAnimationFrame(motionRafRef.current);
    };
  }, [cameraStatus, sensitivity, armed, triggerAlarm]);

  // === Derived display values ===
  const argParts = getArgentinaParts(now);
  const timeStr = `${argParts.hour}:${argParts.minute}:${argParts.second}`;
  const dateStr = `${argParts.weekday}, ${argParts.day} de ${argParts.month}`;

  // Time until next 5:00 AM (ARG)
  const timeUntilAlarm = (() => {
    const cur = getArgentinaHourMinute(now);
    let mins =
      ALARM_HOUR * 60 + ALARM_MINUTE - (cur.hour * 60 + cur.minute);
    if (mins <= 0) mins += 24 * 60;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  })();

  return (
    <div className="App min-h-screen text-stone-100" data-testid="chester-app-root">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-8" data-testid="app-header">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <PawPrint size={22} weight="duotone" className="text-amber-400" />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold tracking-tight text-stone-100">
                Chester Alarm
              </h1>
              <p className="text-xs text-stone-500 tracking-wider uppercase">
                Reloj nocturno · Argentina
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-stone-500 text-sm">
            <Sun size={16} weight="duotone" className="text-amber-500/70" />
            <span>Alarma diaria 05:00 (GMT-3)</span>
          </div>
        </header>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Clock panel */}
          <section
            className="md:col-span-2 bg-stone-900/70 border border-stone-800 rounded-3xl p-8 md:p-10 backdrop-blur-xl flex flex-col justify-center"
            data-testid="clock-panel"
          >
            <div className="flex items-center gap-2 text-stone-500 text-xs uppercase tracking-[0.25em] mb-3">
              <Clock size={14} weight="duotone" />
              <span>Hora Argentina · {TIMEZONE.split("/")[2]}</span>
            </div>
            <div
              className={`font-display tracking-tighter text-7xl md:text-8xl lg:text-[8.5rem] font-semibold text-amber-400 leading-none transition-all ${
                alarmRinging ? "soft-blink" : ""
              }`}
              data-testid="live-clock"
            >
              {timeStr}
            </div>
            <div
              className="mt-4 text-stone-400 text-base md:text-lg capitalize"
              data-testid="live-date"
            >
              {dateStr}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                  armed
                    ? "bg-emerald-400/10 text-emerald-300 border border-emerald-500/30"
                    : "bg-stone-800 text-stone-400 border border-stone-700"
                }`}
                data-testid="armed-badge"
              >
                {armed ? (
                  <Bell size={14} weight="fill" />
                ) : (
                  <BellSlash size={14} weight="fill" />
                )}
                {armed ? "Alarma armada" : "Alarma desactivada"}
              </div>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                  cameraStatus === "running"
                    ? "bg-amber-400/10 text-amber-300 border border-amber-500/30"
                    : "bg-stone-800 text-stone-400 border border-stone-700"
                }`}
                data-testid="camera-badge"
              >
                {cameraStatus === "running" ? (
                  <VideoCamera size={14} weight="fill" />
                ) : (
                  <VideoCameraSlash size={14} weight="fill" />
                )}
                {cameraStatus === "running"
                  ? "Cámara monitoreando"
                  : "Cámara apagada"}
              </div>
              <div className="text-xs text-stone-500" data-testid="time-until-alarm">
                Próxima alarma en{" "}
                <span className="text-stone-200 font-medium">{timeUntilAlarm}</span>
              </div>
            </div>
          </section>

          {/* Alarm status / control */}
          <section
            className="bg-stone-900/70 border border-stone-800 rounded-3xl p-6 md:p-8 backdrop-blur-xl flex flex-col"
            data-testid="alarm-panel"
          >
            <div className="flex items-center gap-2 text-stone-500 text-xs uppercase tracking-[0.25em] mb-4">
              <Bell size={14} weight="duotone" />
              <span>Alarma por voz</span>
            </div>
            <div className="font-display text-5xl font-semibold text-stone-100 leading-none">
              05:00
              <span className="text-base text-stone-500 ml-2 align-top">AM</span>
            </div>
            <p className="text-sm text-stone-400 mt-3 leading-relaxed">
              Suena todos los días en hora argentina. Mensaje:
              <span className="block mt-1 text-stone-300 italic">
                “¡Chester se despertó! Hay que sacarlo al baño.”
              </span>
            </p>

            <button
              onClick={() => setArmed((a) => !a)}
              className={`mt-6 w-full rounded-2xl px-4 py-3 font-medium transition-all duration-300 ease-out hover:-translate-y-0.5 ${
                armed
                  ? "bg-amber-500 text-stone-950 hover:bg-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.25)]"
                  : "bg-stone-800 text-stone-300 hover:bg-stone-700 border border-stone-700"
              }`}
              data-testid="toggle-alarm-button"
            >
              {armed ? "Desactivar alarma" : "Activar alarma"}
            </button>

            <button
              onClick={() => triggerAlarm("test")}
              className="mt-3 w-full rounded-2xl px-4 py-3 font-medium bg-stone-800 text-stone-200 hover:bg-stone-700 hover:text-white border border-stone-700 transition-all duration-300 ease-out hover:-translate-y-0.5 flex items-center justify-center gap-2"
              data-testid="test-alarm-button"
            >
              <Sparkle size={16} weight="duotone" />
              Probar voz ahora
            </button>
          </section>

          {/* Motion camera panel */}
          <section
            className={`md:col-span-2 bg-stone-900/70 border rounded-3xl p-6 md:p-8 backdrop-blur-xl ${
              motionDetected
                ? "border-amber-500/60 amber-pulse"
                : "border-stone-800"
            }`}
            data-testid="motion-panel"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-stone-500 text-xs uppercase tracking-[0.25em]">
                <VideoCamera size={14} weight="duotone" />
                <span>Detector de movimiento · Chester</span>
              </div>
              <button
                onClick={() => setMotionEnabled((v) => !v)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  motionEnabled
                    ? "bg-amber-500 text-stone-950 hover:bg-amber-400"
                    : "bg-stone-800 text-stone-200 hover:bg-stone-700 border border-stone-700"
                }`}
                data-testid="toggle-motion-button"
              >
                {motionEnabled ? "Detener cámara" : "Activar cámara"}
              </button>
            </div>

            <div
              className={`relative aspect-video rounded-2xl overflow-hidden bg-black border ${
                motionDetected ? "border-amber-500" : "border-stone-800"
              }`}
              data-testid="video-container"
            >
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
                data-testid="camera-video"
              />
              {/* Overlay states */}
              {cameraStatus !== "running" && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center text-stone-500 gap-2 bg-gradient-to-b from-stone-900 to-stone-950"
                  data-testid="camera-overlay"
                >
                  <Dog size={56} weight="duotone" className="text-amber-500/60" />
                  <p className="text-sm">
                    {cameraStatus === "requesting"
                      ? "Solicitando permiso de cámara…"
                      : cameraStatus === "error"
                        ? "Sin acceso a la cámara"
                        : "Activá la cámara para vigilar a Chester"}
                  </p>
                  {cameraError && (
                    <p className="text-xs text-rose-400 max-w-xs text-center px-4">
                      {cameraError}
                    </p>
                  )}
                </div>
              )}
              {/* HUD */}
              {cameraStatus === "running" && (
                <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-stone-950/70 backdrop-blur-md text-xs text-stone-200 border border-stone-800">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      motionDetected ? "bg-amber-400 soft-blink" : "bg-emerald-400"
                    }`}
                  />
                  {motionDetected ? "Movimiento" : "Vigilando"}
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />

            {/* Sensitivity */}
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="sensitivity"
                  className="text-xs uppercase tracking-[0.2em] text-stone-500 flex items-center gap-2"
                >
                  <Waveform size={14} weight="duotone" />
                  Sensibilidad
                </label>
                <span className="text-sm text-stone-300 font-medium" data-testid="sensitivity-value">
                  {sensitivity}%
                </span>
              </div>
              <input
                id="sensitivity"
                type="range"
                min={1}
                max={100}
                value={sensitivity}
                onChange={(e) => setSensitivity(parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
                data-testid="sensitivity-slider"
              />
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-stone-800 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      motionDetected ? "bg-amber-400" : "bg-emerald-500/70"
                    }`}
                    style={{ width: `${Math.min(100, motionLevel * 2)}%` }}
                    data-testid="motion-level-bar"
                  />
                </div>
                <span className="text-xs text-stone-500 w-14 text-right">
                  {motionLevel.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-3 leading-relaxed">
                Si detecta movimiento entre las{" "}
                <span className="text-stone-300">04:00</span> y las{" "}
                <span className="text-stone-300">07:00</span> (ARG) y la alarma
                está armada, se dispara la voz automáticamente.
              </p>
            </div>
          </section>

          {/* Event log */}
          <section
            className="bg-stone-900/70 border border-stone-800 rounded-3xl p-6 md:p-8 backdrop-blur-xl flex flex-col"
            data-testid="event-log-panel"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-stone-500 text-xs uppercase tracking-[0.25em]">
                <PawPrint size={14} weight="duotone" />
                <span>Bitácora</span>
              </div>
              {events.length > 0 && (
                <button
                  onClick={() => setEvents([])}
                  className="text-xs text-stone-500 hover:text-stone-300 transition"
                  data-testid="clear-events-button"
                >
                  Limpiar
                </button>
              )}
            </div>
            <div className="flex-1 -mx-2 overflow-y-auto max-h-[420px] pr-1">
              {events.length === 0 ? (
                <div
                  className="text-sm text-stone-500 italic px-2 py-6 text-center"
                  data-testid="empty-events"
                >
                  Sin eventos todavía. <br />
                  Chester duerme tranquilo. 🐾
                </div>
              ) : (
                <ul className="divide-y divide-stone-800">
                  {events.map((ev) => (
                    <li
                      key={ev.id}
                      className="px-2 py-3 flex items-start gap-3"
                      data-testid="event-item"
                    >
                      <span
                        className={`mt-0.5 h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                          ev.type === "alarm"
                            ? "bg-amber-500/15 text-amber-400"
                            : ev.type === "motion"
                              ? "bg-amber-400/10 text-amber-300"
                              : ev.type === "test"
                                ? "bg-emerald-500/10 text-emerald-300"
                                : ev.type === "error"
                                  ? "bg-rose-500/10 text-rose-300"
                                  : "bg-stone-800 text-stone-400"
                        }`}
                      >
                        {ev.type === "alarm" ? (
                          <Bell size={14} weight="fill" />
                        ) : ev.type === "motion" ? (
                          <PawPrint size={14} weight="fill" />
                        ) : ev.type === "test" ? (
                          <Sparkle size={14} weight="fill" />
                        ) : ev.type === "error" ? (
                          <WarningCircle size={14} weight="fill" />
                        ) : (
                          <CheckCircle size={14} weight="fill" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-stone-200 leading-snug">
                          {ev.message}
                        </p>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {formatLogTime(ev.ts)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        <footer className="mt-8 text-center text-xs text-stone-600">
          Hecho con 🐾 para Chester · Mantené esta pestaña abierta para que la
          alarma y la cámara funcionen.
        </footer>
      </div>
    </div>
  );
}
