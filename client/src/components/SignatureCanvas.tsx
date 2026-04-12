import { useRef, useCallback, useImperativeHandle, forwardRef, useEffect } from "react";

export type SignatureCanvasRef = {
  toDataURL: () => string;
  clear: () => void;
};

type Props = {
  width?: number;
  height?: number;
  className?: string;
};

export const SignatureCanvas = forwardRef<SignatureCanvasRef, Props>(
  ({ width = 900, height = 200, className = "" }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const lastPoint = useRef<{ x: number; y: number } | null>(null);

    const canvasPos = (e: React.PointerEvent, c: HTMLCanvasElement) => {
      const r = c.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * c.width,
        y: ((e.clientY - r.top) / r.height) * c.height,
      };
    };

    const startDraw = (e: React.PointerEvent) => {
      const c = canvasRef.current;
      if (!c) return;
      drawing.current = true;
      c.setPointerCapture(e.pointerId);
      lastPoint.current = canvasPos(e, c);
    };

    const draw = (e: React.PointerEvent) => {
      if (!drawing.current) return;
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const p = canvasPos(e, c);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      if (lastPoint.current) ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastPoint.current = p;
    };

    const endDraw = (e: React.PointerEvent) => {
      drawing.current = false;
      lastPoint.current = null;
      canvasRef.current?.releasePointerCapture(e.pointerId);
    };

    const clear = useCallback(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#060b13";
      ctx.fillRect(0, 0, c.width, c.height);
    }, []);

    useEffect(() => {
      clear();
    }, [clear]);

    useImperativeHandle(ref, () => ({
      toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
      clear,
    }));

    return (
      <div className="space-y-2">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={`w-full rounded-xl border border-[#00d4ff]/30 bg-[#060b13] touch-none cursor-crosshair ${className}`}
          style={{ height: "120px" }}
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
        />
        <button
          type="button"
          onClick={clear}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 min-h-0 min-w-0"
        >
          Unterschrift löschen
        </button>
      </div>
    );
  }
);
SignatureCanvas.displayName = "SignatureCanvas";
