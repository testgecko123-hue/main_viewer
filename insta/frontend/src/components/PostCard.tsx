import { memo, useRef, useState } from "react";
import type { Post } from "../types/post";
import { thumbnailSrc, mediaSrc } from "../types/post";
import { useSelection } from "../context/SelectionContext";
import { useInView } from "../hooks/useInView";

type Props = {
    post: Post;
    onClick: () => void;
};

const TYPE_LABEL: Record<number, string> = {
    2: "▶ VIDEO",
    8: "⊞ ALBUM",
};

function PostCard({ post, onClick }: Props) {
    const { isSelected, toggle } = useSelection();
    const [hovered, setHovered] = useState(false);
    const [imgFailed, setImgFailed] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const { ref: thumbRef, inView } = useInView<HTMLDivElement>({
        rootMargin: "400px 0px",
    });

    const selected = isSelected(post);
    const label = TYPE_LABEL[post.mediaType];
    const isVideo = post.mediaType === 2;
    const showImage = inView && !isVideo && !imgFailed;
    const showVideo = inView && isVideo;

    function handleMouseDown(e: React.MouseEvent) {
        if (e.button === 1) {
            e.preventDefault();
            toggle(post);
        }
    }

    function handleMouseEnter() {
        setHovered(true);
        // play() returns a promise that can reject if the mouse leaves
        // before it resolves — safe to swallow, nothing to do about it.
        videoRef.current?.play().catch(() => {});
    }

    function handleMouseLeave() {
        setHovered(false);
        const v = videoRef.current;
        if (v) {
            v.pause();
            v.currentTime = 0;
        }
    }

    return (
        <article
            className={`post-card${selected ? " post-card--selected" : ""}`}
            onClick={onClick}
            onMouseDown={handleMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div
                ref={thumbRef}
                className={`post-card__thumb${!showImage && !showVideo ? " post-card__thumb--loading" : ""}${isVideo ? " post-card__thumb--video" : ""}`}
            >
                {showVideo ? (
                    <>
                        <video
                            ref={videoRef}
                            src={mediaSrc(post.localFile ?? "")}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                        />
                        {!hovered && (
                            <span className="post-card__play" aria-hidden>
                                ▶
                            </span>
                        )}
                    </>
                ) : showImage ? (
                    <img
                        src={thumbnailSrc(post)}
                        loading="lazy"
                        decoding="async"
                        alt=""
                        onError={() => setImgFailed(true)}
                    />
                ) : imgFailed ? (
                    <span className="post-card__media-fallback">No preview</span>
                ) : null}

                {label && <span className="post-card__badge">{label}</span>}
                {selected && <span className="post-card__check">✓</span>}
                {hovered && !selected && (
                    <span className="post-card__hint">middle-click to select</span>
                )}
            </div>

            {post.caption && (
                <p className="post-card__caption">{post.caption}</p>
            )}
        </article>
    );
}

export default memo(PostCard);