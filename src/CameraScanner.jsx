import React, { useEffect, useRef, useState } from 'react';
import { X, Flashlight, FlashlightOff, SwitchCamera, ScanLine, CheckCircle2, AlertCircle, LoaderCircle } from 'lucide-react';
import { SCAN_FORMATS, cleanCode, toLuminance, makeRepeatGuard, cameraErrorMessage } from './barcode-utils';

// Picks the fastest decoder this device offers: the phone's built-in barcode
// detector (most Android phones), or the bundled decoder (iPhone and others).
async function createFrameDecoder() {
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = SCAN_FORMATS.filter(f => supported.includes(f));
      if (formats.includes('ean_13') && formats.includes('code_128')) {
        const detector = new window.BarcodeDetector({ formats });
        return async video => (await detector.detect(video))[0]?.rawValue || null;
      }
    } catch { /* fall back to the bundled decoder */ }
  }
  const { createLuminanceDecoder } = await import('./zxing-decoder.js');
  const decode = createLuminanceDecoder(SCAN_FORMATS);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async video => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    // Read the middle of the picture (where the guide box is). The decoder needs
    // about 3.5 pixels per bar, so only shrink very large pictures.
    const sw = Math.round(vw * 0.86), sh = Math.round(vh * 0.6);
    const scale = Math.min(1, 1400 / sw);
    canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return decode(toLuminance(data, canvas.width, canvas.height), canvas.width, canvas.height);
  };
}

function useBeep() {
  const ctx = useRef(null);
  useEffect(() => {
    try { ctx.current = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx.current = null; }
    return () => { try { ctx.current?.close(); } catch { /* already closed */ } };
  }, []);
  return ok => {
    try { navigator.vibrate?.(ok ? 60 : [40, 60, 40]); } catch { /* not supported */ }
    const ac = ctx.current;
    if (!ac) return;
    try {
      if (ac.state === 'suspended') ac.resume();
      const osc = ac.createOscillator(), gain = ac.createGain();
      osc.frequency.value = ok ? 1650 : 330;
      gain.gain.setValueAtTime(0.0001, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + (ok ? 0.12 : 0.25));
      osc.connect(gain).connect(ac.destination);
      osc.start(); osc.stop(ac.currentTime + 0.3);
    } catch { /* sound is optional */ }
  };
}

/**
 * Full-screen camera barcode scanner.
 * onCode(code) may return { ok, message } to show the result under the camera.
 * continuous: keep scanning after each code (checkout); otherwise close after one.
 */
export default function CameraScanner({ onCode, onClose, continuous = false, title = 'Scan a barcode', hint = 'Fill the box with the barcode' }) {
  const video = useRef(null), stream = useRef(null), closeBtn = useRef(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState('starting'); // starting | scanning | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [torch, setTorch] = useState({ supported: false, on: false });
  const [devices, setDevices] = useState([]);
  const [restart, setRestart] = useState(0); // bump to start the camera again
  const wantedId = useRef(null), currentId = useRef(null);
  const [count, setCount] = useState(0);
  const beep = useBeep();

  useEffect(() => {
    closeBtn.current?.focus();
    const key = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = scroll; };
  }, []);

  useEffect(() => {
    let alive = true, timer = null;
    const guard = makeRepeatGuard(1600);
    async function start() {
      setState('starting'); setError(''); setTorch({ supported: false, on: false });
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('No camera API'), { name: 'NoCameraApi' });
        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: wantedId.current ? { deviceId: { exact: wantedId.current }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (!alive) { media.getTracks().forEach(t => t.stop()); return; }
        stream.current = media;
        const track = media.getVideoTracks()[0];
        const caps = track.getCapabilities?.() || {};
        if (caps.focusMode?.includes?.('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        setTorch({ supported: Boolean(caps.torch), on: false });
        const v = video.current;
        v.srcObject = media;
        await v.play().catch(() => {});
        currentId.current = track.getSettings?.().deviceId || null;
        const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'videoinput' && d.deviceId);
        if (alive) setDevices(cams);
        const decode = await createFrameDecoder();
        if (!alive) return;
        setState('scanning');
        const tick = async () => {
          if (!alive) return;
          let code = null;
          if (!document.hidden && v.readyState >= 2) { try { code = cleanCode(await decode(v)); } catch { code = null; } }
          if (!alive) return;
          if (code && guard(code)) {
            const r = (await onCodeRef.current?.(code)) || { ok: true, message: code };
            if (!alive) return;
            beep(r.ok !== false);
            setResult({ ...r, code, at: Date.now() });
            if (r.ok !== false) setCount(n => n + 1);
            if (!continuous && r.ok !== false) { onClose(); return; }
          }
          timer = setTimeout(tick, code ? 350 : 90);
        };
        tick();
      } catch (e) {
        if (!alive) return;
        setState('error');
        setError(cameraErrorMessage(e));
      }
    }
    start();
    return () => {
      alive = false;
      clearTimeout(timer);
      stream.current?.getTracks().forEach(t => t.stop());
      stream.current = null;
    };
  }, [restart]);

  function switchCamera() {
    if (devices.length < 2) return;
    const i = devices.findIndex(d => d.deviceId === currentId.current);
    wantedId.current = devices[(i + 1) % devices.length].deviceId;
    setRestart(n => n + 1);
  }

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch.on }] }); setTorch(t => ({ ...t, on: !t.on })); } catch { setTorch({ supported: false, on: false }); }
  }

  const fresh = result && Date.now() - result.at < 2600;
  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scanner-top">
        <div>
          <strong>{title}</strong>
          <small>{continuous ? (count ? `${count} scanned · keep scanning, or tap Done` : 'Items are added as you scan') : hint}</small>
        </div>
        <button ref={closeBtn} className="scanner-close" onClick={onClose}>{continuous ? 'Done' : <><X size={18} /> Close</>}</button>
      </div>
      <div className="scanner-view">
        <video ref={video} playsInline muted autoPlay />
        {state !== 'error' && (
          <div className="scanner-frame" aria-hidden="true">
            <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
            {state === 'scanning' && <span className="scanner-laser" />}
          </div>
        )}
        {state === 'starting' && <div className="scanner-status"><LoaderCircle size={18} className="spin" /> Starting camera…</div>}
        {state === 'error' && (
          <div className="scanner-error" role="alert">
            <AlertCircle size={28} />
            <p>{error}</p>
            <button className="primary" onClick={() => { wantedId.current = null; setRestart(n => n + 1); }}>Try again</button>
          </div>
        )}
      </div>
      <div className="scanner-bottom">
        <div className={'scanner-result' + (fresh ? (result.ok === false ? ' is-bad' : ' is-good') : '')} role="status" aria-live="polite">
          {fresh ? (
            <>{result.ok === false ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{result.message}</span></>
          ) : (
            <><ScanLine size={18} /><span>{state === 'scanning' ? 'Fill the box with the barcode and hold steady. Good light helps.' : ' '}</span></>
          )}
        </div>
        <div className="scanner-tools">
          {torch.supported && (
            <button onClick={toggleTorch} aria-pressed={torch.on} aria-label={torch.on ? 'Turn light off' : 'Turn light on'}>
              {torch.on ? <FlashlightOff size={20} /> : <Flashlight size={20} />}<span>{torch.on ? 'Light off' : 'Light'}</span>
            </button>
          )}
          {devices.length > 1 && (
            <button onClick={switchCamera} aria-label="Switch camera">
              <SwitchCamera size={20} /><span>Switch camera</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
