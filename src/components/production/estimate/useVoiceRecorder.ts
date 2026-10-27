import { useEffect, useRef, useState } from 'react';

/** Records one voice memo in the browser or the phone apps (MediaRecorder) and hands it back as a data URL. */
export function useVoiceRecorder(maxSeconds = 120) {
  const [recording, setRecording] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm', 'audio/mp4', 'audio/aac'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || type || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => setDataUrl(String(reader.result));
        reader.readAsDataURL(blob);
        setRecording(false);
      };
      rec.current = r;
      r.start();
      setRecording(true);
      timer.current = window.setTimeout(() => r.state === 'recording' && r.stop(), maxSeconds * 1000);
    } catch {
      setError('The microphone is not available. Type a note instead.');
      setRecording(false);
    }
  };
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };
  const clear = () => setDataUrl(null);
  return { recording, dataUrl, error, start, stop, clear };
}
