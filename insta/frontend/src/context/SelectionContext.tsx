import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import type { Post } from "../types/post";
import { API_URL } from "../config";

const STORAGE_KEY = "instavault-selection";
const SAVE_DEBOUNCE_MS = 400;

type SelectionCtx = {
    selection: Post[];
    count: number;
    hydrated: boolean;
    isSelected: (post: Post) => boolean;
    toggle: (post: Post) => void;
    remove: (post: Post) => void;
    clear: () => void;
    shuffle: () => void;
};

const Ctx = createContext<SelectionCtx | null>(null);

function loadLocalShortcodes(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
    } catch {
        return [];
    }
}

function saveLocalShortcodes(shortcodes: string[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcodes));
    } catch {}
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
    const [selection, setSelection] = useState<Post[]>([]);
    const [hydrated, setHydrated] = useState(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;

    const persist = useCallback((posts: Post[]) => {
        const shortcodes = posts.map((p) => p.shortcode);
        saveLocalShortcodes(shortcodes);
        return axios.put(`${API_URL}/selection`, { shortcodes }).catch(() => {});
    }, []);

    // Hydrate from server + library on mount
    useEffect(() => {
        let cancelled = false;

        async function hydrate() {
            const local = loadLocalShortcodes();
            let shortcodes = local;

            try {
                const res = await axios.get(`${API_URL}/selection`);
                if (Array.isArray(res.data?.shortcodes) && res.data.shortcodes.length > 0) {
                    shortcodes = res.data.shortcodes;
                    saveLocalShortcodes(shortcodes);
                }
            } catch {}

            if (shortcodes.length === 0) {
                if (!cancelled) setHydrated(true);
                return;
            }

            try {
                const libRes = await axios.get(`${API_URL}/posts`);
                const library: Post[] = libRes.data ?? [];
                const map = new Map(library.map((p) => [p.shortcode, p]));
                const restored = shortcodes
                    .map((sc) => map.get(sc))
                    .filter((p): p is Post => Boolean(p));

                if (!cancelled) {
                    setSelection(restored);
                    setHydrated(true);
                }
            } catch {
                if (!cancelled) setHydrated(true);
            }
        }

        hydrate();
        return () => { cancelled = true; };
    }, []);

    // Debounced save on change
    useEffect(() => {
        if (!hydrated) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            persist(selectionRef.current);
        }, SAVE_DEBOUNCE_MS);
        return () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
        };
    }, [selection, hydrated, persist]);

    // Save on page unload
    useEffect(() => {
        const onUnload = () => {
            const shortcodes = selectionRef.current.map((p) => p.shortcode);
            saveLocalShortcodes(shortcodes);
            navigator.sendBeacon?.(
                `${API_URL}/selection`,
                new Blob([JSON.stringify({ shortcodes })], { type: "application/json" })
            );
        };
        window.addEventListener("beforeunload", onUnload);
        return () => window.removeEventListener("beforeunload", onUnload);
    }, []);

    function isSelected(post: Post) {
        return selection.some((p) => p.shortcode === post.shortcode);
    }

    function toggle(post: Post) {
        setSelection((prev) =>
            prev.some((p) => p.shortcode === post.shortcode)
                ? prev.filter((p) => p.shortcode !== post.shortcode)
                : [...prev, post]
        );
    }

    function remove(post: Post) {
        setSelection((prev) => prev.filter((p) => p.shortcode !== post.shortcode));
    }

    function clear() {
        setSelection([]);
    }

    function shuffle() {
        setSelection((prev) => [...prev].sort(() => Math.random() - 0.5));
    }

    return (
        <Ctx.Provider
            value={{
                selection,
                count: selection.length,
                hydrated,
                isSelected,
                toggle,
                remove,
                clear,
                shuffle,
            }}
        >
            {children}
        </Ctx.Provider>
    );
}

export function useSelection() {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error("useSelection must be inside SelectionProvider");
    return ctx;
}
