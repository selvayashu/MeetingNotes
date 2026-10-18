import { useEffect, useRef } from 'react';

/** Live oscilloscope-style waveform from an AnalyserNode. */
export default function Waveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const data = new Uint8Array(analyser?.fftSize ?? 1024);

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = canvas;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const style = getComputedStyle(canvas);
      ctx.strokeStyle = active ? style.getPropertyValue('--wave').trim() || '#4f46e5' : style.getPropertyValue('--muted').trim() || '#9ca3af';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (analyser && active) {
        analyser.getByteTimeDomainData(data);
        const step = w / data.length;
        for (let i = 0; i < data.length; i++) {
          const y = h / 2 + ((data[i] - 128) / 128) * (h / 2) * 1.6;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * step, y);
        }
      } else {
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
      }
      ctx.stroke();
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [analyser, active]);

  return <canvas ref={canvasRef} className="waveform" aria-hidden />;
}
