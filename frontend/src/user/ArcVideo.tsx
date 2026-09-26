import { useEffect, useRef } from 'react';

const ARC_LOGO_SRC = '/arc/arc-logo-spin.mp4';

interface ArcVideoProps {
  className?: string;
  /** Defaults to the ArcGPT logo mark; the chat backdrop passes its own clip. */
  src?: string;
}

/**
 * Displays the supplied MP4 directly. The unchanged source clips are retained
 * beside the browser-facing render; native looping keeps the original
 * animation and timing intact, with no CSS/SVG/text substitute.
 */
export function ArcVideo({ className = '', src = ARC_LOGO_SRC }: ArcVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => undefined);
  }, []);

  return (
    <video
      ref={videoRef}
      className={`arc-video ${className}`.trim()}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
