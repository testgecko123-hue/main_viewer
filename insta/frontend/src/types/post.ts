export type Post = {
    id: string;
    shortcode: string;
    caption: string;
    /** Unix seconds — when the post was published on Instagram */
    timestamp: number | null;
    /** Unix ms — when the post was accepted into the library */
    savedAt?: number | null;
    username: string;
    mediaType: number; // 1 = image, 2 = video, 8 = carousel
    localFile?: string;
    children?: string[];
};

import { API_URL } from "../config";

export function mediaSrc(path: string): string {
    return `${API_URL}/${path}`;
}

export function thumbnailSrc(post: Post): string {
    if (post.mediaType === 8 && post.children?.length) {
        const paths = post.children.filter(
            (c): c is string => typeof c === "string" && c.length > 0
        );
        const first =
            paths.find((c) => !c.endsWith(".mp4")) ?? paths[0];
        if (first) return mediaSrc(first);
    }
    return mediaSrc(post.localFile ?? "");
}

export function instagramUrl(post: Post): string {
    return `https://www.instagram.com/p/${post.shortcode}/`;
}

export function formatDate(timestamp: number | null): string {
    if (!timestamp) return "";
    return new Date(timestamp * 1000).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

export function formatSavedAt(savedAt: number | null | undefined): string {
    if (!savedAt) return "";
    return new Date(savedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}
