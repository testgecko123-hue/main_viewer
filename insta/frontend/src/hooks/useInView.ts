import { useEffect, useRef, useState } from "react";

type Options = {
    rootMargin?: string;
    threshold?: number;
    /** When false, observer disconnects and inView stays false */
    enabled?: boolean;
};

export function useInView<T extends Element>(options: Options = {}) {
    const { rootMargin = "300px 0px", threshold = 0, enabled = true } = options;
    const ref = useRef<T>(null);
    // Once true, stays true — prevents re-loading media when virtualisation
    // unmounts and remounts a card that has already been seen.
    const [inView, setInView] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el || !enabled) return;

        // Already seen — no need to observe again.
        if (inView) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setInView(true);
                    observer.disconnect(); // one-shot: seen once → always loaded
                }
            },
            { rootMargin, threshold }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [rootMargin, threshold, enabled, inView]);

    return { ref, inView };
}