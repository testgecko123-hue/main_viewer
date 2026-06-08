import { useState } from "react";
import { useSelection } from "../context/SelectionContext";
import type { Post } from "../types/post";
import PostGrid from "../components/PostGrid";
import PostModal from "../components/PostModal";

export default function SelectionPage() {
    const { selection, count, clear, shuffle, remove } = useSelection();
    const [focused, setFocused] = useState<Post | null>(null);

    return (
        <div className="page">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Selection</h1>
                    <p className="page-subtitle">{count} posts selected</p>
                </div>
                <div className="btn-row">
                    <button
                        type="button"
                        className="btn"
                        onClick={shuffle}
                        disabled={count < 2}
                    >
                        Shuffle
                    </button>
                    <button
                        type="button"
                        className="btn btn--danger"
                        onClick={clear}
                        disabled={count === 0}
                    >
                        Clear
                    </button>
                </div>
            </header>

            {count === 0 ? (
                <p className="empty-state">
                    Middle-click posts in the Library to add them here.
                </p>
            ) : (
                <PostGrid posts={selection} onSelect={setFocused} />
            )}

            {focused && (
                <>
                    <PostModal post={focused} onClose={() => setFocused(null)} />
                    <button
                        type="button"
                        className="btn btn--danger modal-floating-btn"
                        onClick={() => {
                            remove(focused);
                            setFocused(null);
                        }}
                    >
                        Remove from selection
                    </button>
                </>
            )}
        </div>
    );
}
