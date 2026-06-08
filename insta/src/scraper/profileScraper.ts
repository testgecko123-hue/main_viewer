import { Page } from "playwright";
import { scrapeReels } from "./reelsScraper";

const SKIP_RECURSE_KEYS = new Set([
    "carousel_media",
    "edge_sidecar_to_children",
    "carousel_parent_id",
    "suggested_users",
]);

const PINNED_COUNT = 3;
const QUICK_CHECK_COUNT = 10;

function ownerUsername(obj: any): string | null {
    const u =
        obj?.user?.username ??
        obj?.owner?.username ??
        obj?.caption?.user?.username;
    return u ? String(u).toLowerCase() : null;
}

/** -1 = unlimited scroll until end of profile or abort */
export function isUnlimitedTarget(targetPosts: number): boolean {
    return targetPosts < 0;
}

export type ScrapeMode = "posts" | "reels";

export type ScrapeProfileOptions = {
    knownShortcodes?: Set<string>;
    scrollWaitMs?: number;
};

export async function scrapeProfile(
    page: Page,
    username: string,
    targetPosts: number = 30,
    shouldStop?: () => boolean,
    mode: ScrapeMode = "posts",
    options: ScrapeProfileOptions = {}
) {
    if (mode === "reels") {
        return scrapeReels(page, username, {
            targetPosts,
            knownShortcodes: options.knownShortcodes,
            shouldStop,
            scrollWaitMs: options.scrollWaitMs ?? 1800,
            maxNoNew: 3,
        });
    }

    const baseUrl = `https://www.instagram.com/${username}/`;
    const targetUser = username.toLowerCase();
    const unlimited = isUnlimitedTarget(targetPosts);
    const known = options.knownShortcodes ?? new Set<string>();
    const scrollWaitMs = options.scrollWaitMs ?? 1800;

    console.log(
        `Opening ${baseUrl} (target: ${unlimited ? "unlimited" : targetPosts}, mode: ${mode})`
    );

    const posts: any[] = [];
    const seen = new Set<string>();

    function atTarget(): boolean {
        return !unlimited && posts.length >= targetPosts;
    }

    function isValidNode(obj: any) {
        if (!obj) return false;

        const hasCode = obj.code;
        const hasId = obj.id || obj.pk;

        const hasMedia =
            obj.image_versions2?.candidates?.length ||
            obj.video_versions?.length ||
            obj.carousel_media?.length ||
            obj.edge_sidecar_to_children?.edges?.length;

        const owner = ownerUsername(obj);
        if (!owner || owner !== targetUser) return false;

        const notAd =
            !obj.ad_id &&
            !obj.is_paid_partnership &&
            !obj.sponsor_tags &&
            obj.product_type !== "ad" &&
            !obj.is_organic_product_placement &&
            obj.label !== "Sponsored";

        return Boolean(hasCode && hasId && hasMedia && notAd);
    }

    function resolveMediaType(obj: any): number | null {
        const t = obj.media_type;

        if (t === 8 || obj.carousel_media?.length || obj.edge_sidecar_to_children?.edges?.length) {
            return 8;
        }

        if (t === 2 || obj.video_versions?.length) {
            return 2;
        }

        if (t === 1 || obj.image_versions2?.candidates?.length) {
            return 1;
        }

        return null;
    }

    function findPosts(obj: any) {
        if (!obj || typeof obj !== "object" || atTarget()) return;

        if (isValidNode(obj)) {
            const shortcode = obj.code;

            if (!seen.has(shortcode)) {
                const mediaType = resolveMediaType(obj);

                if (mediaType === null) return;

                seen.add(shortcode);

                posts.push({
                    id: obj.id || obj.pk,
                    shortcode,
                    caption: obj.caption?.text || "",
                    timestamp: obj.taken_at || null,
                    mediaType,
                    image_versions2: obj.image_versions2,
                    video_versions: obj.video_versions,
                    carousel_media:
                        mediaType === 8
                            ? (obj.carousel_media ??
                               obj.edge_sidecar_to_children?.edges?.map((e: any) => e.node))
                            : undefined,
                    isPinned: Boolean(obj.timeline_pinned_user_ids?.length),
                });

                console.log(
                    `NEW POST: ${shortcode} (type ${mediaType}) [${posts.length}${unlimited ? "" : `/${targetPosts}`}]`
                );

                if (atTarget()) return;
            }
        }

        for (const key in obj) {
            if (SKIP_RECURSE_KEYS.has(key)) continue;
            if (atTarget()) return;
            findPosts(obj[key]);
        }
    }

    function isProfileResponse(responseUrl: string): boolean {
        if (responseUrl.includes("/api/v1/feed/user/")) return true;
        if (responseUrl.includes("/api/v1/users/web_profile_info")) return true;

        if (responseUrl.includes("/api/v1/feed/") && !responseUrl.includes("/user/")) {
            return false;
        }

        if (responseUrl.includes("/graphql/query")) {
            const blocked = [
                "xdt_api__v1__feed__timeline",
                "SuggestedUsers",
                "RecommendedUsers",
            ];
            if (blocked.some((b) => responseUrl.includes(b))) return false;
            return true;
        }

        return false;
    }

    /** Skip full scroll when posts 4-10 are all already known (pinned 1-3 ignored). */
    function shouldStopEarly(): boolean {
        if (known.size === 0 || posts.length < QUICK_CHECK_COUNT) return false;
        const checkSlice = posts.slice(PINNED_COUNT, QUICK_CHECK_COUNT);
        if (checkSlice.length < QUICK_CHECK_COUNT - PINNED_COUNT) return false;
        return checkSlice.every((p) => known.has(p.shortcode));
    }

    page.on("response", async (response) => {
        if (page.isClosed() || atTarget() || shouldStop?.()) return;

        try {
            const responseUrl = response.url();

            if (!isProfileResponse(responseUrl)) return;

            const ct = response.headers()["content-type"] || "";

            if (!ct.includes("application/json")) return;

            const json = await response.json();

            if (!page.isClosed() && !atTarget()) {
                findPosts(json);
            }
        } catch {}
    });

    async function openRoute(url: string, label: string): Promise<boolean> {
        try {
            await page.bringToFront();
            await page.goto(url, {
                waitUntil: "commit",
                timeout: 60000,
            });
            await page.waitForLoadState("domcontentloaded", { timeout: 20000 });
            await page.waitForTimeout(2000);
            return true;
        } catch (err: any) {
            const msg = err?.message ?? String(err);
            console.log(`Could not open ${label} route: ${msg}`);
            return false;
        }
    }

    const opened = await openRoute(`${baseUrl}?_fresh=${Date.now()}`, "profile");
    if (!opened) {
        throw new Error("Failed opening profile route");
    }

    let prev = posts.length;
    let stuck = 0;
    const maxNoNew = unlimited ? 4 : 3;

    while (!atTarget()) {
        if (page.isClosed() || shouldStop?.()) {
            console.log("Scraping stopped.");
            break;
        }

        if (shouldStopEarly()) {
            console.log(
                `No new posts in positions ${PINNED_COUNT + 1}-${QUICK_CHECK_COUNT} (pinned ${PINNED_COUNT} skipped) — stopping early.`
            );
            break;
        }

        console.log(
            `[profile] Collected: ${posts.length}${unlimited ? "" : ` / ${targetPosts}`}`
        );

        try {
            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight * 2);
            });
        } catch {
            console.log("Page closed during scroll.");
            break;
        }

        try {
            await page.waitForTimeout(scrollWaitMs);
        } catch {
            console.log("Scraper stopped (page closed)");
            break;
        }

        if (posts.length === prev) {
            stuck++;
            console.log(`[profile] No new media (${stuck}/${maxNoNew})`);
        } else {
            stuck = 0;
        }

        prev = posts.length;

        if (stuck >= maxNoNew) {
            console.log("Finished profile section.");
            break;
        }
    }

    if (!unlimited && posts.length > targetPosts) {
        return posts.slice(0, targetPosts);
    }

    console.log(`Scrape finished: ${posts.length} posts`);
    return posts;
}
