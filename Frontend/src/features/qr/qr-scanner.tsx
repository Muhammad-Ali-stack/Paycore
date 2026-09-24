'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import jsQR from 'jsqr';
import { Camera, CameraOff, ImageUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

declare global {
  interface Window {
    /** Mock-mode only test hook: feeds a payload as if the camera had read it. */
    __paycoreInjectQr?: (payload: string) => void;
  }
}

async function decodeFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/**
 * Camera QR scanner (getUserMedia + jsQR) with two fallbacks that also make it
 * testable without a camera: upload a photo of the code, or paste the code text.
 */
export function QrScanner({ onResult, disabled }: { onResult: (payload: string) => void; disabled?: boolean }) {
  const t = useTranslations('scan');
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const rafRef = React.useRef<number>(0);
  const [active, setActive] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [paste, setPaste] = React.useState('');
  const onResultRef = React.useRef(onResult);
  React.useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const stop = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  React.useEffect(() => stop, [stop]);

  React.useEffect(() => {
    if (process.env.NEXT_PUBLIC_API_MOCKING !== 'enabled') return;
    window.__paycoreInjectQr = (payload: string) => onResultRef.current(payload);
    return () => {
      delete window.__paycoreInjectQr;
    };
  }, []);

  /** One decode attempt per animation frame until a code is found or the camera stops. */
  const scanLoop = () => {
    function frame() {
      const video = videoRef.current;
      if (!video || !streamRef.current) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const canvas = (canvasRef.current ??= document.createElement('canvas'));
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            stop();
            onResultRef.current(code.data);
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  };

  const start = async () => {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem(t('cameraUnavailable'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      scanLoop();
    } catch (e) {
      setProblem(
        e instanceof DOMException && e.name === 'NotAllowedError' ? t('cameraDenied') : t('cameraUnavailable'),
      );
    }
  };

  return (
    <div className="grid gap-5">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl border border-border bg-raised">
        <video
          ref={videoRef}
          className="size-full object-cover"
          playsInline
          muted
          aria-label={t('scanning')}
          hidden={!active}
        />
        {!active ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Camera className="size-10 text-fg-muted" aria-hidden />
            <p className="text-sm text-fg-muted">{t('subtitle')}</p>
          </div>
        ) : (
          <>
            {/* Gold corner frame */}
            <div aria-hidden className="pointer-events-none absolute inset-10 rounded-lg border-2 border-accent/70" />
            <p role="status" className="absolute inset-x-0 bottom-3 text-center text-xs text-fg">
              {t('scanning')}
            </p>
          </>
        )}
      </div>
      {problem ? (
        <p role="alert" className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        {active ? (
          <Button variant="secondary" onClick={stop}>
            <CameraOff aria-hidden /> {t('stopCamera')}
          </Button>
        ) : (
          <Button onClick={() => void start()} disabled={disabled}>
            <Camera aria-hidden /> {t('startCamera')}
          </Button>
        )}
        <Button variant="secondary" asChild>
          <label className="cursor-pointer">
            <ImageUp aria-hidden /> {t('uploadImage')}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              data-testid="qr-upload"
              disabled={disabled}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setProblem(null);
                const data = await decodeFile(f).catch(() => null);
                if (data) onResult(data);
                else setProblem(t('noQrInImage'));
              }}
            />
          </label>
        </Button>
      </div>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (paste.trim()) onResult(paste.trim());
        }}
      >
        <Field label={t('pasteLabel')}>
          <Input
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={t('pastePlaceholder')}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            data-testid="qr-paste"
          />
        </Field>
        <Button type="submit" variant="outline" disabled={!paste.trim() || disabled} data-testid="qr-paste-submit">
          {t('use')}
        </Button>
      </form>
    </div>
  );
}
