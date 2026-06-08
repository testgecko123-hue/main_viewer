import { useEffect, type RefObject } from "react";
import type { MediaRendererHandle } from "../components/MediaRenderer";

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

type MediaKeyOptions = {
    enabled: boolean;
    mediaRef: RefObject<MediaRendererHandle | null>;
    onReject?: () => void;
    onAccept?: () => void;
    onPrevPost?: () => void;
    onNextPost?: () => void;
    onToggleInfo?: () => void;
};

export function useMediaKeyboard({
    enabled,
    mediaRef,
    onReject,
    onAccept,
    onPrevPost,
    onNextPost,
    onToggleInfo,
}: MediaKeyOptions) {
    useEffect(() => {
        if (!enabled) return;

        function onKey(e: KeyboardEvent) {
            if (isTypingTarget(e.target)) return;

            const media = mediaRef.current;

            switch (e.key) {
                case "ArrowLeft":
                    if (onReject) {
                        e.preventDefault();
                        onReject();
                    } else if (onPrevPost) {
                        e.preventDefault();
                        onPrevPost();
                    }
                    break;
                case "ArrowRight":
                    if (onAccept) {
                        e.preventDefault();
                        onAccept();
                    } else if (onNextPost) {
                        e.preventDefault();
                        onNextPost();
                    }
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    media?.carouselPrev();
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    media?.carouselNext();
                    break;
                case "j":
                case "J":
                    e.preventDefault();
                    media?.scrub(-1);
                    break;
                case "l":
                case "L":
                    e.preventDefault();
                    media?.scrub(1);
                    break;
                case "i":
                case "I":
                    if (onToggleInfo) {
                        e.preventDefault();
                        onToggleInfo();
                    }
                    break;
                case " ":
                    e.preventDefault();
                    media?.togglePlayPause();
                    break;
                default:
                    break;
            }
        }

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [
        enabled,
        mediaRef,
        onReject,
        onAccept,
        onPrevPost,
        onNextPost,
        onToggleInfo,
    ]);
}
