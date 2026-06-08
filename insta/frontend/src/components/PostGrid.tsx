import type { Post } from "../types/post";
import PostCard from "./PostCard";

type Props = {
    posts: Post[];
    onSelect: (post: Post) => void;
};

export default function PostGrid({ posts, onSelect }: Props) {
    if (posts.length === 0) return null;

    return (
        <div className="post-grid">
            {posts.map((post) => (
                <PostCard
                    key={post.id ?? post.shortcode}
                    post={post}
                    onClick={() => onSelect(post)}
                />
            ))}
        </div>
    );
}
