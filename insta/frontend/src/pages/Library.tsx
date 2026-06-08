import { useEffect, useMemo, useState } from "react";
import { fetchPosts, deletePost } from "../api/posts";
import type { Post } from "../types/post";
import PostGrid from "../components/PostGrid";
import PostModal from "../components/PostModal";
import LibraryFilters, {
    filterAndSortPosts,
    type SortMode,
} from "../components/LibraryFilters";
import { useSelection } from "../context/SelectionContext";

export default function Library() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [selected, setSelected] = useState<Post | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>("default");
    const [userFilter, setUserFilter] = useState("");
    const [shuffleKey, setShuffleKey] = useState(0);
    const { remove: removeFromSelection } = useSelection();

    useEffect(() => {
        load();
    }, []);

    async function load() {
        const data = await fetchPosts();
        setPosts(data);
    }

    async function handleRemove(post: Post) {
        await deletePost(post.shortcode);
        setPosts((prev) => prev.filter((p) => p.shortcode !== post.shortcode));
        removeFromSelection(post);
        setSelected(null);
    }

    const displayed = useMemo(() => {
        void shuffleKey;
        return filterAndSortPosts(posts, sortMode, userFilter);
    }, [posts, sortMode, userFilter, shuffleKey]);

    function handleSortChange(mode: SortMode) {
        setSortMode(mode);
        if (mode === "random") {
            setShuffleKey((k) => k + 1);
        }
    }

    const subtitle =
        displayed.length === posts.length
            ? `${posts.length} saved · middle-click to select`
            : `${displayed.length} of ${posts.length} · middle-click to select`;

    return (
        <div className="page">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Library</h1>
                    <p className="page-subtitle">{subtitle}</p>
                </div>
            </header>
            <LibraryFilters
                posts={posts}
                sortMode={sortMode}
                userFilter={userFilter}
                onSortChange={handleSortChange}
                onUserFilterChange={setUserFilter}
                onReshuffle={() => setShuffleKey((k) => k + 1)}
            />
            <PostGrid posts={displayed} onSelect={setSelected} />
            <PostModal
                post={selected}
                onClose={() => setSelected(null)}
                onRemove={handleRemove}
            />
        </div>
    );
}
