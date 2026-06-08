import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import type { Post } from "../types/post";
import { mediaSrc } from "../types/post";

export type MediaRendererHandle = {
    carouselNext: () => void;
    carouselPrev: () => void;
    scrub: (seconds: number) => void;
    togglePlayPause: () => void;
};

type Props = {
    post: Post | any;
    objectFit?: "contain" | "cover";
    height?: string | number;
    fill?: boolean;
    loopCarousel?: boolean;
    showSlideCounter?: boolean;
};

function validCarouselPaths(children: unknown): string[] {
    if (!Array.isArray(children)) return [];
    return children.filter(
        (c): c is string => typeof c === "string" && c.length > 0
    );
}

const MediaRenderer = forwardRef<MediaRendererHandle, Props>(function MediaRenderer(
    {
        post,
        objectFit = "contain",
        height = "100%",
        fill = false,
        loopCarousel = true,
        showSlideCounter = true,
    },
    ref
) {
    const [carouselIdx, setCarouselIdx] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);

    const postKey = post?.shortcode ?? post?.id ?? "";

    const carouselItems = useMemo(
        () => (post?.mediaType === 8 ? validCarouselPaths(post.children) : []),
        [post?.mediaType, post?.children, postKey]
    );

    const carouselTotal = carouselItems.length;

    useEffect(() => {
        setCarouselIdx(0);
    }, [postKey]);

    useEffect(() => {
        if (carouselIdx >= carouselTotal && carouselTotal > 0) {
            setCarouselIdx(0);
        }
    }, [carouselIdx, carouselTotal]);

    function goCarousel(delta: number) {
        if (carouselTotal <= 1) return;
        setCarouselIdx((i) => {
            const next = i + delta;
            if (loopCarousel) {
                return ((next % carouselTotal) + carouselTotal) % carouselTotal;
            }
            return Math.max(0, Math.min(carouselTotal - 1, next));
        });
    }

    function scrub(seconds: number) {
        const el = videoRef.current;
        if (!el || !Number.isFinite(el.duration)) return;
        el.currentTime = Math.max(
            0,
            Math.min(el.duration, el.currentTime + seconds)
        );
    }

    function togglePlayPause() {
        const el = videoRef.current;
        if (!el) return;
        if (el.paused) {
            void el.play();
        } else {
            el.pause();
        }
    }

    useImperativeHandle(ref, () => ({
        carouselNext: () => goCarousel(1),
        carouselPrev: () => goCarousel(-1),
        scrub,
        togglePlayPause,
    }));

    const mediaStyle: React.CSSProperties = fill
        ? { objectFit, display: "block" }
        : {
              width: "100%",
              height: "100%",
              objectFit,
              display: "block",
          };

    const wrapClass = fill ? "media-wrap media-wrap--fill" : "media-wrap";
    const wrapStyle: React.CSSProperties = fill ? { height: "100%" } : { height };

    if (!post) {
        return (
            <div className={wrapClass} style={wrapStyle}>
                <div className="media-placeholder">No media</div>
            </div>
        );
    }

    // ── VIDEO ────────────────────────────────────────────────
    if (post.mediaType === 2 && post.localFile) {
        return (
            <div className={wrapClass} style={wrapStyle}>
                <video
                    ref={videoRef}
                    key={post.localFile}
                    src={mediaSrc(post.localFile)}
                    controls
                    className="media-element"
                    style={mediaStyle}
                />
            </div>
        );
    }

    // ── CAROUSEL ─────────────────────────────────────────────
    if (post.mediaType === 8 && carouselTotal > 0) {
        const safeIdx = Math.min(
            Math.max(0, carouselIdx),
            carouselTotal - 1
        );
        const current = carouselItems[safeIdx];
        const isVideo = current.endsWith(".mp4");

        return (
            <div className={wrapClass} style={wrapStyle}>
                {isVideo ? (
                    <video
                        ref={videoRef}
                        key={current}
                        src={mediaSrc(current)}
                        controls
                        className="media-element"
                        style={mediaStyle}
                    />
                ) : (
                    <img
                        src={mediaSrc(current)}
                        className="media-element"
                        style={mediaStyle}
                        alt=""
                    />
                )}

                {carouselTotal > 1 && (
                    <>
                        <button
                            type="button"
                            className="media-nav media-nav--left"
                            onClick={(e) => {
                                e.stopPropagation();
                                goCarousel(-1);
                            }}
                            aria-label="Previous slide"
                        >
                            ‹
                        </button>
                        <button
                            type="button"
                            className="media-nav media-nav--right"
                            onClick={(e) => {
                                e.stopPropagation();
                                goCarousel(1);
                            }}
                            aria-label="Next slide"
                        >
                            ›
                        </button>

                        <div className="media-dots">
                            {carouselItems.map((_, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    className={`media-dot${i === safeIdx ? " media-dot--active" : ""}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setCarouselIdx(i);
                                    }}
                                    aria-label={`Slide ${i + 1}`}
                                />
                            ))}
                        </div>

                        {showSlideCounter && (
                            <span className="media-slide-counter">
                                {safeIdx + 1} / {carouselTotal}
                            </span>
                        )}
                    </>
                )}
            </div>
        );
    }

    // ── IMAGE (default) ────────────────────────────────────────
    if (post.localFile) {
        return (
            <div className={wrapClass} style={wrapStyle}>
                <img
                    src={mediaSrc(post.localFile)}
                    className="media-element"
                    style={mediaStyle}
                    alt=""
                />
            </div>
        );
    }

    return (
        <div className={wrapClass} style={wrapStyle}>
            <div className="media-placeholder">Media unavailable</div>
        </div>
    );
});

export default MediaRenderer;
