import { useEffect, useRef } from "react";

interface TemplatePreviewVideoProps {
  src: string;
  className: string;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
}

export function TemplatePreviewVideo({
  src,
  className,
  controls = false,
  autoPlay = false,
  muted = true,
  loop = false
}: TemplatePreviewVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.pause();
    video.load();

    if (!autoPlay) {
      return;
    }

    const startPreview = async () => {
      try {
        video.currentTime = 0;
        await video.play();
      } catch {
        // Browsers may still block autoplay occasionally; controls remain available.
      }
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      void startPreview();
      return;
    }

    const handleLoadedData = () => {
      void startPreview();
    };

    video.addEventListener("loadeddata", handleLoadedData, { once: true });

    return () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.pause();
    };
  }, [autoPlay, src]);

  return (
    <video
      key={src}
      ref={videoRef}
      className={className}
      controls={controls}
      muted={muted}
      loop={loop}
      playsInline
      preload="auto"
      src={src}
    />
  );
}
