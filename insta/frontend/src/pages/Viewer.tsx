import { useCallback, useEffect, useRef, useState } from "react";
import { useSelection } from "../context/SelectionContext";
import MediaRenderer, { type MediaRendererHandle } from "../components/MediaRenderer";
import { instagramUrl } from "../types/post";
import { useMediaKeyboard } from "../hooks/useMediaKeyboard";

export default function Viewer() {
    const { selection } = useSelection();
    const [index, setIndex] = useState(0);
    const [showInfo, setShowInfo] = useState(false);
    const mediaRef = useRef<MediaRendererHandle>(null);

    const total = selection.length;
    const current = selection[index] ?? null;

    useEffect(() => {
        setIndex((i) => Math.min(i, Math.max(0, total - 1)));
    }, [total]);

    const goPrev = useCallback(() => {
        if (total <= 0) return;
        setIndex((i) => (i - 1 + total) % total);
    }, [total]);

    const goNext = useCallback(() => {
        if (total <= 0) return;
        setIndex((i) => (i + 1) % total);
    }, [total]);

    const toggleInfo = useCallback(() => {
        setShowInfo((v) => !v);
    }, []);

    useMediaKeyboard({
        enabled: Boolean(current),
        mediaRef,
        onPrevPost: goPrev,
        onNextPost: goNext,
        onToggleInfo: toggleInfo,
    });

    if (!current) {
        return (
            <div className="page viewer-page">
                <p className="empty-state">
                    Add posts to your selection from the Library (middle-click).
                </p>
            </div>
        );
    }

    return (
        <div className={`page viewer-page${showInfo ? " viewer-page--info-open" : ""}`}>
            <div className="viewer-toolbar">
                <span className="review-counter">
                    <strong>{index + 1}</strong> / {total}
                </span>
                <div className="review-hints" style={{ textAlign: "left" }}>
                    ←→ posts (loop) · ↑↓ carousel · J/L ±1s · Space play · I info
                </div>
                <button type="button" className="btn btn--ghost" onClick={toggleInfo}>
                    {showInfo ? "Hide info" : "Show info"}
                </button>
            </div>

            <div className="viewer-stage">
                <div className="viewer-stage__inner">
                    <MediaRenderer
                        ref={mediaRef}
                        post={current}
                        objectFit="contain"
                        fill
                        loopCarousel
                    />
                </div>
            </div>

            {showInfo && (
                <div className="viewer-info">
                    <div className="viewer-info__user">@{current.username}</div>
                    <div className="viewer-info__caption">
                        {current.caption || "(no caption)"}
                    </div>
                    <a href={instagramUrl(current)} target="_blank" rel="noreferrer">
                        instagram.com/p/{current.shortcode} ↗
                    </a>
                </div>
            )}
        </div>
    );
}
