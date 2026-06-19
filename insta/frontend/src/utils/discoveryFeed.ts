import type { Post } from "../types/post";

export type Subscription = {
    username: string;
    addedAt: number;
    lastScraped: number;
};

function fisherYatesShuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function shufflePick<T>(items: T[], count: number): T[] {
    const pool = [...items];
    const picked: T[] = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
        const j = Math.floor(Math.random() * pool.length);
        picked.push(pool[j]);
        pool.splice(j, 1);
    }
    return picked;
}

function compareTimestampDesc(a: Post, b: Post): number {
    if (a.timestamp === null && b.timestamp === null) return 0;
    if (a.timestamp === null) return 1;
    if (b.timestamp === null) return -1;
    return b.timestamp - a.timestamp;
}

function batchSizeForAccount(postCount: number): number {
    return Math.min(5, Math.max(1, Math.ceil(postCount / 50)));
}

export function buildDiscoveryFeed(
    posts: Post[],
    subscriptions: Subscription[]
): Post[] {
    const groups = new Map<string, Post[]>();
    for (const post of posts) {
        const username = post.username ?? "";
        const group = groups.get(username);
        if (group) {
            group.push(post);
        } else {
            groups.set(username, [post]);
        }
    }

    const sortedGroups = new Map<string, Post[]>();
    for (const [username, group] of groups) {
        sortedGroups.set(username, [...group].sort(compareTimestampDesc));
    }

    const subByUsername = new Map<string, Subscription>();
    for (const sub of subscriptions) {
        subByUsername.set(sub.username, sub);
    }

    const withSub: string[] = [];
    const withoutSub: string[] = [];
    for (const username of sortedGroups.keys()) {
        if (subByUsername.has(username)) {
            withSub.push(username);
        } else {
            withoutSub.push(username);
        }
    }

    withSub.sort(
        (a, b) =>
            (subByUsername.get(b)?.lastScraped ?? 0) -
            (subByUsername.get(a)?.lastScraped ?? 0)
    );
    withoutSub.sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    const roundOrder = fisherYatesShuffle([...withSub, ...withoutSub]);

    const pools = new Map<string, Post[]>();
    const accountPostCounts = new Map<string, number>();
    for (const [username, group] of sortedGroups) {
        pools.set(username, [...group]);
        accountPostCounts.set(username, group.length);
    }

    const output: Post[] = [];

    while ([...pools.values()].some((pool) => pool.length > 0)) {
        for (const account of roundOrder) {
            const pool = pools.get(account);
            if (!pool || pool.length === 0) continue;

            const batchSize = batchSizeForAccount(
                accountPostCounts.get(account) ?? pool.length
            );
            const window = pool.slice(0, Math.min(5, pool.length));
            const picked = shufflePick(window, batchSize);

            for (const post of picked) {
                const idx = pool.indexOf(post);
                if (idx !== -1) pool.splice(idx, 1);
            }

            output.push(...picked);
        }
    }

    return output;
}
