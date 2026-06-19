import { useRef } from "react";
import type { Post } from "../types/post";
import PostCard from "./PostCard";
import { useVirtualGrid } from "../hooks/useVirtualGrid";

type Props = {
    posts: Post[];
    onSelect: (post: Post) => void;
};

const VIRTUAL_THRESHOLD = 48;

export default function PostGrid({ posts, onSelect }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const useVirtual = posts.length >= VIRTUAL_THRESHOLD;
    const { start, end, topSpacer, bottomSpacer } = useVirtualGrid(
        posts.length,
        containerRef,
        useVirtual
    );

    if (posts.length === 0) return null;

    const visible = useVirtual ? posts.slice(start, end) : posts;

    return (
        <div ref={containerRef} className="post-grid-virtual">
            {useVirtual && topSpacer > 0 && (
                <div className="post-grid-virtual__spacer" style={{ height: topSpacer }} />
            )}
            <div className="post-grid">
                {visible.map((post) => (
                    <PostCard
                        key={post.id ?? post.shortcode}
                        post={post}
                        onClick={() => onSelect(post)}
                    />
                ))}
            </div>
            {useVirtual && bottomSpacer > 0 && (
                <div className="post-grid-virtual__spacer" style={{ height: bottomSpacer }} />
            )}
        </div>
    );
}
