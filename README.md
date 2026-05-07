# Chester Alarm 🐾

Reloj nocturno con **alarma por voz programada para las 5:00 AM (hora Argentina)** y **detección de movimiento por cámara web** para alertarte cuando tu perro se despierta.

> *"¡Chester se despertó! Hay que sacarlo al baño…"*

---

## 🎯 Qué hace

- ⏰ **Reloj en vivo** con hora de Argentina (`America/Argentina/Buenos_Aires`).
- 🔔 **Alarma por voz** automática todos los días a las **05:00 AM** usando la Web Speech API del navegador (en español argentino si está disponible).
- 📹 **Detector de movimiento** por webcam con sensibilidad ajustable.
- 🐶 Si detecta movimiento entre las **04:00 y las 07:00 AM**, también dispara la voz (con cooldown de 1 minuto).
- 📋 Bitácora persistente con los últimos 25 eventos.
- 🌙 Diseño dark con paleta ámbar pensado para que no encandile a las 5 AM.

---

## 🚀 Deploy en Netlify (3 minutos)

### Opción A — Drag & Drop (la más rápida)

1. Instalá las dependencias y generá el build de producción:
   ```bash
   yarn install
   yarn build
   ```
2. Andá a [app.netlify.com](https://app.netlify.com) → **Sites** → **Add new site** → **Deploy manually**.
3. Arrastrá la carpeta **`build/`** al recuadro. Listo, en ~30 segundos tenés la URL.

### Opción B — Conectar con GitHub (deploys automáticos)

1. Subí esta carpeta a un repositorio en GitHub.
2. En Netlify: **Add new site** → **Import from Git** → elegí el repo.
3. Netlify detecta el `netlify.toml` automáticamente. Solo confirmá:
   - **Build command:** `yarn build`
   - **Publish directory:** `build`
4. Click en **Deploy site**.

---

## 📱 Usar en el celular como "app"

Una vez deployada, abrí la URL de Netlify en tu celu y guardala en la pantalla de inicio:

- **iPhone (Safari):** botón Compartir → *"Agregar a pantalla de inicio"*.
- **Android (Chrome):** menú ⋮ → *"Agregar a pantalla de inicio"* o *"Instalar app"*.

---

## ⚠️ Importante para que la alarma funcione

1. **La pestaña/app debe quedar abierta** durante la noche. La Web Speech API y la cámara requieren un documento activo.
2. **Tocá "Probar voz ahora"** una vez después de abrir la app, para que el navegador habilite el audio (la mayoría de los navegadores móviles bloquean el TTS hasta que hay una primera interacción del usuario).
3. **Concedé permisos** de cámara cuando lo pida el navegador.
4. **Mantené el celular enchufado** y **desactivá el modo "ahorro de batería extremo"** (Android suele matar pestañas en segundo plano).
5. **Subí el volumen** del dispositivo. 🔊
6. En iOS, evitá que la pantalla se bloquee — podés usar el modo *Guided Access* (Acceso Guiado) o un cargador conectado para que no se duerma.

---

## 🛠️ Desarrollo local

```bash
yarn install
yarn start
```

La app se abre en `http://localhost:3000`.

---

## 📂 Estructura del proyecto

```
chester-alarm/
├── public/
│   └── index.html
├── src/
│   ├── App.js          ← toda la lógica del reloj, alarma y detección
│   ├── App.css
│   ├── index.css       ← Tailwind + tipografías Outfit / Manrope
│   └── index.js
├── craco.config.js     ← alias '@' → src/
├── tailwind.config.js
├── postcss.config.js
├── netlify.toml        ← config de Netlify
├── package.json
└── README.md
```

---

## 🧰 Tech stack

- **React 19** (Create React App + Craco para alias `@/`)
- **Tailwind CSS 3**
- **@phosphor-icons/react** (íconos duotone)
- **Web APIs nativas:**
  - `Intl.DateTimeFormat` con timezone Argentina
  - `window.speechSynthesis` (TTS)
  - `navigator.mediaDevices.getUserMedia` (webcam)
  - `<canvas>` con frame-diff para detección de movimiento
- **localStorage** para persistir preferencias y bitácora
- **Sin backend** ✨ → ideal para Netlify

---

## 💡 Posibles mejoras futuras

- Snooze (postergar 5 min)
- Beep de respaldo por si el TTS está silenciado a nivel SO
- Convertirla en PWA instalable con Service Worker
- Múltiples horarios de alarma configurables
- Detección de perro con TensorFlow.js (para reducir falsos positivos)

---

Hecho con 🐾 para Chester.
