import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import { usePaintedBox } from "@/features/gallery/hooks/usePaintedBox";
import { useVideoFrameLoop } from "@/features/gallery/hooks/useVideoFrameLoop";
import {
  createAdjustedPicture,
  type AdjustedPicture,
  type PublishedPicture,
} from "@/features/gallery/lib/adjustedPicture";
import { AdjustRenderer, canZoom, zoomView } from "@/features/gallery/lib/adjustRenderer";
import {
  adjustPixel,
  buildAdjustLut,
  GLOBAL_TOOLS,
  isAdjustIdentity,
  isGlobalIdentity,
} from "@/features/gallery/lib/colorAdjust";
import { ADJUST_PREVIEW_LUT_SIZE } from "@/shared/constants";
import { classNames } from "@/shared/lib/classNames";
import type { CropRect } from "@/features/gallery/lib/crop";
import type { ColorAdjustControls } from "@/features/gallery/hooks/useColorAdjust";

type AdjustMedia = HTMLImageElement | HTMLVideoElement;

const MAX_BACKING_PIXELS = 4096 * 4096;
const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 };

interface AdjustCanvasProps {
  mediaRef: RefObject<AdjustMedia | null>;
  sourceWidth: number;
  sourceHeight: number;
  crop: CropRect;
  scale: number;
  controls: ColorAdjustControls;
  onPictureChange?: (picture: AdjustedPicture | null) => void;
  onShowingChange?: (showing: boolean) => void;
}

function mediaReady(media: AdjustMedia): boolean {
  return media instanceof HTMLVideoElement
    ? media.readyState >= media.HAVE_CURRENT_DATA && media.videoWidth > 0
    : media.complete && media.naturalWidth > 0;
}

export function AdjustCanvas({
  mediaRef,
  sourceWidth,
  sourceHeight,
  crop,
  scale,
  controls,
  onPictureChange,
  onShowingChange,
}: AdjustCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AdjustRenderer | null>(null);
  const mediaRefRef = useRef(mediaRef);
  mediaRefRef.current = mediaRef;
  const frameRef = useRef(0);
  const lutKeyRef = useRef("");
  const originRef = useRef({ x: 0.5, y: 0.5 });
  const pictureRef = useRef<PublishedPicture | null>(null);
  const [picture, setPicture] = useState<PublishedPicture | null>(null);
  const [available, setAvailable] = useState(true);
  const [noiseAvailable, setNoiseAvailable] = useState(true);
  const box = usePaintedBox(mediaRef, sourceWidth, sourceHeight);

  const { values, comparing, zoomed, active, setZoomed, setPreviewAvailable } = controls;
  const previewAvailable = available && (noiseAvailable || values.noise_reduction < 1e-9);
  const live = previewAvailable && (active || !isAdjustIdentity(values));

  useEffect(() => {
    setPreviewAvailable(previewAvailable);
  }, [previewAvailable, setPreviewAvailable]);

  const stateRef = useRef({ values, comparing, zoomed, crop, scale, sourceWidth, sourceHeight });
  stateRef.current = { values, comparing, zoomed, crop, scale, sourceWidth, sourceHeight };

  const outputSize = useCallback(() => {
    const state = stateRef.current;
    return {
      width: Math.max(1, Math.round(state.crop.width * state.sourceWidth * state.scale)),
      height: Math.max(1, Math.round(state.crop.height * state.sourceHeight * state.scale)),
    };
  }, []);

  const frameSize = useCallback(() => {
    const state = stateRef.current;
    return { width: state.sourceWidth * state.scale, height: state.sourceHeight * state.scale };
  }, []);

  const renderNow = useCallback(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas || !renderer.hasSource) return;
    const state = stateRef.current;

    const lutKey = GLOBAL_TOOLS.map((tool) => state.values[tool]).join(",");
    if (lutKey !== lutKeyRef.current) {
      lutKeyRef.current = lutKey;
      const global = !isGlobalIdentity(state.values);
      renderer.setLut(
        global ? buildAdjustLut(state.values, ADJUST_PREVIEW_LUT_SIZE) : null,
        ADJUST_PREVIEW_LUT_SIZE,
      );
      if (pictureRef.current) {
        const [r, g, b] = adjustPixel([0, 0, 0], state.values).map((v) => Math.round(v * 255));
        pictureRef.current.blackout = `rgb(${r}, ${g}, ${b})`;
      }
    }

    const output = outputSize();
    renderer.render({
      view: state.zoomed ? zoomView(originRef.current, canvas, frameSize()) : FULL_FRAME,
      crop: state.crop,
      outputScale: state.scale,
      outputSize: output,
      detail: { noiseReduction: state.values.noise_reduction, definition: state.values.definition },
      original: state.comparing,
    });
    pictureRef.current?.publish();
  }, [frameSize, outputSize]);

  const scheduleRender = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      renderNow();
    });
  }, [renderNow]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      // StrictMode remounts this instance; a stale id would turn every later render away.
      frameRef.current = 0;
    },
    [],
  );

  const upload = useCallback(async () => {
    const renderer = rendererRef.current;
    const media = mediaRefRef.current.current;
    if (!renderer || !media || !mediaReady(media)) return;

    if (media instanceof HTMLVideoElement) {
      renderer.setSource(media, media.videoWidth, media.videoHeight, true);
      renderNow();
      return;
    }

    // An ImageBitmap honours EXIF orientation the way the `<img>` does.
    const bitmap = await createImageBitmap(media, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
    });
    if (rendererRef.current !== renderer) {
      bitmap.close();
      return;
    }
    renderer.setSource(bitmap, bitmap.width, bitmap.height, true);
    bitmap.close();
    scheduleRender();
  }, [renderNow, scheduleRender]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const start = () => {
      rendererRef.current = AdjustRenderer.create(canvas);
      const started = rendererRef.current !== null;
      setAvailable(started);
      setNoiseAvailable(rendererRef.current?.floatTargets ?? false);
      if (started) {
        lutKeyRef.current = "";
        void upload();
      }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      rendererRef.current = null;
      setAvailable(false);
    };

    start();
    pictureRef.current = createAdjustedPicture(canvas);
    setPicture(pictureRef.current);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", start);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", start);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [upload]);

  // Paused videos may load and seek without presenting a frame callback.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const events =
      media instanceof HTMLVideoElement ? ["loadeddata", "seeked", "canplay"] : ["load"];
    const load = () => void upload();
    for (const event of events) media.addEventListener(event, load);
    return () => {
      for (const event of events) media.removeEventListener(event, load);
    };
  }, [mediaRef, upload]);

  useEffect(() => {
    if (live) void upload();
  }, [live, mediaRef, upload]);

  useVideoFrameLoop(mediaRef, () => void upload(), live);

  const pixelWidth = Math.round(box.width * window.devicePixelRatio);
  const pixelHeight = Math.round(box.height * window.devicePixelRatio);
  const shrink = Math.min(1, Math.sqrt(MAX_BACKING_PIXELS / Math.max(1, pixelWidth * pixelHeight)));
  const backingWidth = Math.max(1, Math.round(pixelWidth * shrink));
  const backingHeight = Math.max(1, Math.round(pixelHeight * shrink));

  const zoomable = active && canZoom({ width: backingWidth, height: backingHeight }, frameSize());

  useEffect(() => {
    if (live) scheduleRender();
  }, [live, values, comparing, zoomed, crop, scale, backingWidth, backingHeight, scheduleRender]);

  useEffect(() => {
    onShowingChange?.(live);
  }, [live, onShowingChange]);

  useEffect(() => {
    onPictureChange?.(live && !zoomed ? picture : null);
  }, [live, onPictureChange, picture, zoomed]);

  useEffect(() => () => onPictureChange?.(null), [onPictureChange]);

  const originFrom = (event: PointerEvent<HTMLCanvasElement>) => {
    const { offsetWidth, offsetHeight } = event.currentTarget;
    // offsetX/Y are in the canvas's own frame, so a rotated or mirrored stage needs no mapping.
    originRef.current = {
      x: Math.min(1, Math.max(0, event.nativeEvent.offsetX / Math.max(1, offsetWidth))),
      y: Math.min(1, Math.max(0, event.nativeEvent.offsetY / Math.max(1, offsetHeight))),
    };
  };

  const style = useMemo(
    () =>
      ({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }) as CSSProperties,
    [box],
  );

  return (
    <canvas
      ref={canvasRef}
      className={classNames(
        "adjust-canvas",
        zoomable && "adjust-canvas--inspectable",
        zoomed && "adjust-canvas--zoomed",
      )}
      width={backingWidth}
      height={backingHeight}
      style={style}
      hidden={!live}
      aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0 || !(zoomable || zoomed)) return;
        originFrom(event);
        setZoomed(!zoomed);
      }}
      onPointerMove={(event) => {
        if (!zoomed) return;
        originFrom(event);
        scheduleRender();
      }}
    />
  );
}
