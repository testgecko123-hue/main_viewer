import { useState } from "react";
import type { Post } from "../types/post";
import { thumbnailSrc, mediaSrc } from "../types/post";
import { useSelection } from "../context/SelectionContext";

type Props = {
    post: Post;
    onClick: () => void;
};

const TYPE_LABEL: Record<number, string> = {
    2: "▶ VIDEO",
    8: "⊞ ALBUM",
};

export default function PostCard({ post, onClick }: Props) {
    const { isSelected, toggle } = useSelection();
    const [hovered, setHovered] = useState(false);
    const selected = isSelected(post);
    const label = TYPE_LABEL[post.mediaType];
    const isVideo = post.mediaType === 2;

    function handleMouseDown(e: React.MouseEvent) {
        if (e.button === 1) {
            e.preventDefault();
            toggle(post);
        }
    }

    return (
        <article
            className={`post-card${selected ? " post-card--selected" : ""}`}
            onClick={onClick}
            onMouseDown={handleMouseDown}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div className="post-card__thumb">
                {isVideo ? (
                    <video
                        src={mediaSrc(post.localFile ?? "")}
                        muted
                        preload="metadata"
                    />
                ) : (
                    <img src={thumbnailSrc(post)} loading="lazy" alt="" />
                )}

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
