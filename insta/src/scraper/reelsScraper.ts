import { Page } from "playwright";

const SKIP_RECURSE_KEYS = new Set([
    "carousel_media",
    "edge_sidecar_to_children",
    "carousel_parent_id",
    "suggested_users",
    // Do NOT skip "items" — reels live inside items[] arrays
]);

function ownerUsername(obj: any): string | null {
    const u =
        obj?.user?.username ??
        obj?.owner?.username ??
        obj?.caption?.user?.username;
    return u ? String(u).toLowerCase() : null;
}

function isReelsResponse(url: string): boolean {
    // Instagram web now routes almost everything through /api/graphql (no trailing path)
    if (url.includes("instagram.com/api/graphql")) return true;
    // Legacy endpoints still worth catching
    if (url.includes("/api/v1/feed/reels_media")) return true;
    if (url.includes("/api/v1/clips/")) return true;
    if (url.includes("/graphql/query")) return true;
    return false;
}

function isValidReelNode(obj: any, targetUser: string): boolean {
    if (!obj || typeof obj !== "object") return false;

    const hasCode = obj.code || obj.shortcode || obj.media?.code || obj.media?.shortcode;
    const hasId = obj.id || obj.pk || obj.media?.id || obj.media?.pk;
    const hasVideo =
        obj.video_versions?.length ||
        obj.media?.video_versions?.length ||
        obj.clips_metadata ||
        obj.media?.clips_metadata ||
        obj.product_type === "clips" ||
        obj.media?.product_type === "clips" ||
        obj.media_type === 2 ||
        obj.media?.media_type === 2;

    // Owner check — try multiple locations, but don't fail if owner missing
    const owner = ownerUsername(obj) ?? ownerUsername(obj.media);
    if (owner && owner !== targetUser) return false;

    const notAd =
        !obj.ad_id &&
        !obj.is_paid_partnership &&
        obj.product_type !== "ad" &&
        obj.label !== "Sponsored";

    return Boolean(hasCode && hasId && hasVideo && notAd);
}

function normalizeReelNode(obj: any) {
    const media = obj.media ?? obj;
    const shortcode =
        media.code || media.shortcode ||
        obj.code || obj.shortcode;

    // Derive shortcode from ID if missing (Instagram encodes it in base64)
    const id = media.id || media.pk || obj.id || obj.pk;

    return {
        id,
        shortcode: shortcode || String(id),
        caption: media.caption?.text || obj.caption?.text || "",
        timestamp: media.taken_at || obj.taken_at || null,
        mediaType: 2,
        image_versions2: media.image_versions2 || obj.image_versions2,
        video_versions: media.video_versions || obj.video_versions,
        isReel: true,
    };
}

export type ReelsScrapeOptions = {
    targetPosts?: number;
    knownShortcodes?: Set<string>;
    shouldStop?: () => boolean;
    scrollWaitMs?: number;
    maxNoNew?: number;
};

/**
 * Scrape only the reels tab for a user.
 * Uses reels-specific API response filters.
 */
export async function scrapeReels(
    page: Page,
    username: string,
    options: ReelsScrapeOptions = {}
) {
    const targetUser = username.toLowerCase();
    const baseUrl = `https://www.instagram.com/${username}/reels/`;
    const unlimited = (options.targetPosts ?? 30) < 0;
    const targetPosts = options.targetPosts ?? 30;
    const known = options.knownShortcodes ?? new Set<string>();
    const scrollWaitMs = options.scrollWaitMs ?? 1800;
    const maxNoNew = options.maxNoNew ?? 3;

    const posts: any[] = [];
    const seen = new Set<string>();

    function atTarget() {
        return !unlimited && posts.length >= targetPosts;
    }

    function findReels(obj: any) {
        if (!obj || typeof obj !== "object" || atTarget()) return;

        if (Array.isArray(obj)) {
            for (const item of obj) {
                if (atTarget()) return;
                findReels(item);
            }
            return;
        }

        if (isValidReelNode(obj, targetUser)) {
            const node = normalizeReelNode(obj);
            if (!seen.has(node.shortcode)) {
                seen.add(node.shortcode);
                posts.push(node);
                console.log(`NEW REEL: ${node.shortcode} [${posts.length}]`);
                if (atTarget()) return;
            }
        }

        for (const key of Object.keys(obj)) {
            if (SKIP_RECURSE_KEYS.has(key)) continue;
            if (atTarget()) return;
            findReels(obj[key]);
        }
    }

    page.on("response", async (response) => {
        if (page.isClosed() || atTarget() || options.shouldStop?.()) return;
        try {
            const url = response.url();
            if (!isReelsResponse(url)) return;
            const ct = response.headers()["content-type"] || "";
            if (!ct.includes("application/json") && !ct.includes("text/javascript")) return;

            let json: any;
            try { json = await response.json(); } catch { return; }
            if (!json || typeof json !== "object") return;

            // For /api/graphql catch-all: only process if the response looks like
            // it contains reels/clips data. Check for known reels container keys.
            const raw = JSON.stringify(json);
            const looksLikeReels =
                raw.includes("clips") ||
                raw.includes("reels") ||
                raw.includes("xdt_api__v1__clips") ||
                raw.includes("media_type\":2") ||
                raw.includes("product_type\":\"clips\"") ||
                raw.includes("video_versions");

            if (!looksLikeReels) return;

            // Log top-level structure so we can see the shape
            function logShape(obj: any, depth = 0, prefix = ""): void {
                if (depth > 3 || !obj || typeof obj !== "object") return;
                for (const k of Object.keys(obj).slice(0, 12)) {
                    const v = obj[k];
                    const t = Array.isArray(v) ? `Array(${v.length})` : typeof v;
                    console.log(`${"  ".repeat(depth)}${prefix}${k}: ${t}`);
                    if (typeof v === "object" && v && !Array.isArray(v) && depth < 2) {
                        logShape(v, depth + 1);
                    }
                }
            }
            console.log(`\n[REELS RESPONSE] ${url.split("?")[0]}`);
            logShape(json);
            console.log("---");

            if (!page.isClosed() && !atTarget()) findReels(json);
        } catch {}
    });

    await page.bringToFront();
    await page.goto(`${baseUrl}?_fresh=${Date.now()}`, {
        waitUntil: "commit",
        timeout: 60000,
    });
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 });
    // Give Instagram more time to fire the reels API calls on initial load
    await page.waitForTimeout(4000);

    let prev = posts.length;
    let stuck = 0;

    while (!atTarget()) {
        if (page.isClosed() || options.shouldStop?.()) break;

        try {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        } catch {
            break;
        }

        await page.waitForTimeout(scrollWaitMs);

        if (posts.length === prev) {
            stuck++;
            if (stuck >= maxNoNew) break;
        } else {
            stuck = 0;
        }
        prev = posts.length;
    }

    if (!unlimited && posts.length > targetPosts) {
        return posts.slice(0, targetPosts);
    }
    return posts;
}