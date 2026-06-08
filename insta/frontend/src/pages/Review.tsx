import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import MediaRenderer, { type MediaRendererHandle } from "../components/MediaRenderer";
import { instagramUrl } from "../types/post";
import { useMediaKeyboard } from "../hooks/useMediaKeyboard";
import { API_URL } from "../config";

export default function Review() {
    const [posts, setPosts] = useState<any[]>([]);
    const mediaRef = useRef<MediaRendererHandle>(null);

    async function load() {
        const res = await axios.get(`${API_URL}/review`);
        setPosts(res.data);
    }

    useEffect(() => {
        load();
    }, []);

    const current = posts[0];
    const queueTotal = posts.length;
    const queuePosition = queueTotal > 0 ? 1 : 0;

    async function accept(post: any) {
        await axios.post(`${API_URL}/review/accept`, {
            shortcode: post.shortcode,
        });
        setPosts((prev) => prev.filter((p) => p.shortcode !== post.shortcode));
    }

    async function reject(post: any) {
        await axios.post(`${API_URL}/review/reject`, {
            shortcode: post.shortcode,
        });
        setPosts((prev) => prev.filter((p) => p.shortcode !== post.shortcode));
    }

    const handleReject = useCallback(() => {
        if (current) reject(current);
    }, [current]);

    const handleAccept = useCallback(() => {
        if (current) accept(current);
    }, [current]);

    useMediaKeyboard({
        enabled: Boolean(current),
        mediaRef,
        onReject: handleReject,
        onAccept: handleAccept,
    });

    if (!current) {
        return (
            <div className="page review-page">
                <p className="empty-state">Review queue empty</p>
            </div>
        );
    }

    return (
        <div className="page review-page">
            <div className="review-topbar">
                <span className="review-counter">
                    <strong>{queuePosition}</strong> / {queueTotal}
                </span>
                <div className="review-hints">
                    ← reject · → accept
                    <br />
                    ↑↓ carousel · J/L ±1s
                </div>
            </div>

            <article className="review-card">
                <MediaRenderer
                    ref={mediaRef}
                    post={current}
                    objectFit="contain"
                    height="min(62vh, 680px)"
                    loopCarousel
                />

                <div className="review-card__body">
                    <div className="review-card__user">
                        @{current.username ?? "unknown"}
                    </div>

                    <div className="review-card__caption">
                        {current.caption || "(no caption)"}
                    </div>

                    <a
                        className="review-card__link"
                        href={instagramUrl(current)}
                        target="_blank"
                        rel="noreferrer"
                    >
                        instagram.com/p/{current.shortcode} ↗
                    </a>

                    <div className="btn-row">
                        <button
                            type="button"
                            className="btn btn--danger"
                            onClick={() => reject(current)}
                        >
                            Reject ←
                        </button>
                        <button
                            type="button"
                            className="btn btn--primary"
                            onClick={() => accept(current)}
                        >
                            Accept →
                        </button>
                    </div>
                </div>
            </article>
        </div>
    );
}
