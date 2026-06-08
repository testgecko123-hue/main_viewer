import type { Post } from "../types/post";
import { instagramUrl, formatDate, formatSavedAt } from "../types/post";
import MediaRenderer from "./MediaRenderer";

type Props = {
    post: Post | null;
    onClose: () => void;
    onRemove?: (post: Post) => void;
};

export default function PostModal({ post, onClose, onRemove }: Props) {
    if (!post) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
                <div className="modal-panel__media">
                    <MediaRenderer post={post} objectFit="contain" height="70vh" loopCarousel />
                </div>

                <div className="modal-panel__body">
                    <div className="modal-panel__meta">
                        <span className="modal-panel__user">@{post.username}</span>
                        <span className="modal-panel__date">
                            {formatDate(post.timestamp)
                                ? `Posted ${formatDate(post.timestamp)}`
                                : ""}
                            {formatDate(post.timestamp) && formatSavedAt(post.savedAt)
                                ? " · "
                                : ""}
                            {formatSavedAt(post.savedAt)
                                ? `Saved ${formatSavedAt(post.savedAt)}`
                                : !formatDate(post.timestamp)
                                  ? "—"
                                  : ""}
                        </span>
                    </div>
                    {post.caption && (
                        <p className="modal-panel__caption">{post.caption}</p>
                    )}
                    <a href={instagramUrl(post)} target="_blank" rel="noreferrer">
                        instagram.com/p/{post.shortcode} ↗
                    </a>

                    {onRemove && (
                        <div className="btn-row" style={{ marginTop: 16 }}>
                            <button
                                type="button"
                                className="btn btn--danger"
                                onClick={() => onRemove(post)}
                            >
                                Remove from library
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
