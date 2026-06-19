import { useMemo } from "react";
import type { Post } from "../types/post";

export type SortMode =
    | "default"
    | "random"
    | "discovery"
    | "instagram_newest"
    | "instagram_oldest"
    | "saved_newest"
    | "saved_oldest"
    | "username";

type Props = {
    posts: Post[];
    sortMode: SortMode;
    userFilter: string;
    onSortChange: (mode: SortMode) => void;
    onUserFilterChange: (username: string) => void;
    onReshuffle?: () => void;
    onResort?: () => void;
};

function shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function compareNullable(a: number | null | undefined, b: number | null | undefined, asc: boolean) {
    const missing = asc ? Number.MAX_SAFE_INTEGER : -1;
    const av = a ?? missing;
    const bv = b ?? missing;
    return asc ? av - bv : bv - av;
}

export function filterAndSortPosts(
    posts: Post[],
    sortMode: SortMode,
    userFilter: string
): Post[] {
    let list = userFilter
        ? posts.filter((p) => p.username === userFilter)
        : [...posts];

    switch (sortMode) {
        case "random":
            list = shuffle(list);
            break;
        case "instagram_newest":
            list.sort((a, b) => compareNullable(a.timestamp, b.timestamp, false));
            break;
        case "instagram_oldest":
            list.sort((a, b) => compareNullable(a.timestamp, b.timestamp, true));
            break;
        case "saved_newest":
            list.sort((a, b) => compareNullable(a.savedAt, b.savedAt, false));
            break;
        case "saved_oldest":
            list.sort((a, b) => compareNullable(a.savedAt, b.savedAt, true));
            break;
        case "username":
            list.sort((a, b) =>
                (a.username ?? "").localeCompare(b.username ?? "", undefined, {
                    sensitivity: "base",
                })
            );
            break;
        case "default":
        default:
            break;
    }

    return list;
}

export default function LibraryFilters({
    posts,
    sortMode,
    userFilter,
    onSortChange,
    onUserFilterChange,
    onReshuffle,
    onResort,
}: Props) {
    const usernames = useMemo(() => {
        const set = new Set<string>();
        for (const p of posts) {
            if (p.username) set.add(p.username);
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [posts]);

    const listId = "library-user-suggestions";

    return (
        <div className="library-filters">
            <div className="library-filters__group library-filters__group--sort">
                <label className="library-filters__label" htmlFor="library-sort">
                    Sort
                </label>
                <div className="library-filters__sort-row">
                    <select
                        id="library-sort"
                        className="library-filters__select"
                        value={sortMode}
                        onChange={(e) => onSortChange(e.target.value as SortMode)}
                    >
                        <option value="default">Default order</option>
                        <option value="random">Random</option>
                        <option value="discovery">Discover (Mixed)</option>
                        <optgroup label="Instagram date">
                            <option value="instagram_newest">Newest on Instagram</option>
                            <option value="instagram_oldest">Oldest on Instagram</option>
                        </optgroup>
                        <optgroup label="Added to library">
                            <option value="saved_newest">Recently saved</option>
                            <option value="saved_oldest">Earliest saved</option>
                        </optgroup>
                        <option value="username">Account (A–Z)</option>
                    </select>
                    {sortMode === "random" && onReshuffle && (
                        <button
                            type="button"
                            className="library-shuffle-btn"
                            onClick={onReshuffle}
                            title="Reshuffle"
                            aria-label="Reshuffle random order"
                        >
                            ↻
                        </button>
                    )}
                    {sortMode === "discovery" && onResort && (
                        <button
                            type="button"
                            className="library-shuffle-btn"
                            onClick={onResort}
                            title="Resort"
                            aria-label="Resort discovery feed"
                        >
                            ↻
                        </button>
                    )}
                </div>
            </div>

            <div className="library-filters__group library-filters__group--grow">
                <label className="library-filters__label" htmlFor="library-user">
                    Account
                </label>
                <input
                    id="library-user"
                    className="library-filters__input"
                    list={listId}
                    placeholder="All accounts — type to filter"
                    value={userFilter}
                    onChange={(e) => onUserFilterChange(e.target.value.trim())}
                />
                <datalist id={listId}>
                    {usernames.map((u) => (
                        <option key={u} value={u} />
                    ))}
                </datalist>
            </div>

            {userFilter && (
                <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => onUserFilterChange("")}
                >
                    Clear
                </button>
            )}
        </div>
    );
}
