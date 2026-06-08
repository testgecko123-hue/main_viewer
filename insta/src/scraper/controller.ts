import { scrapeProfile, isUnlimitedTarget, ScrapeMode } from "./profileScraper";
import { launchBrowser, newScrapePage } from "../browser/browser";
import { scraperState } from "./state";
import { downloadPosts } from "../downloader/downloader";
import { addSubscription, getSubscriptions, updateLastScraped } from "../subscriptions/subscriptions";
import { addToReviewQueue } from "../subscriptions/reviewQueue";
import { isRejected } from "../subscriptions/rejectedPosts";
import { getKnownShortcodes } from "./knownPosts";

let currentAbort = false;

function normalizeUsername(raw: string): string {
    return raw.trim().replace(/^@/, "").toLowerCase();
}

export type ScrapeRunOptions = {
    resetAbort?: boolean;
    manageRunningState?: boolean;
    mode?: ScrapeMode;
    workerIndex?: number;
};

async function runScrapeForUser(
    username: string,
    target: number,
    options?: ScrapeRunOptions
) {
    const resetAbort = options?.resetAbort ?? true;
    const manageRunning = options?.manageRunningState ?? true;
    const mode: ScrapeMode = options?.mode ?? "posts";
    const workerIndex = options?.workerIndex ?? 0;

    if (resetAbort) {
        currentAbort = false;
    }

    if (manageRunning) {
        scraperState.running = true;
    }

    scraperState.currentUser = username;
    scraperState.target = target;
    scraperState.collected = 0;
    scraperState.mode = mode;

    const known = getKnownShortcodes(username);
    const page = await newScrapePage(workerIndex > 0);

    try {
        const posts = await scrapeProfile(
            page,
            username,
            target,
            () => currentAbort,
            mode,
            { knownShortcodes: known, scrollWaitMs: 1500 }
        );

        const cap = isUnlimitedTarget(target) ? posts : posts.slice(0, target);

        console.log(`Found ${cap.length} ${mode} for @${username}`);

        addSubscription(username);

        const toDownload = cap.filter((p) => !isRejected(p.shortcode));
        const skippedRejected = cap.length - toDownload.length;

        if (skippedRejected > 0) {
            console.log(`Skipping ${skippedRejected} rejected post(s)`);
        }

        const total = toDownload.length;

        if (total === 0) {
            console.log("Nothing to download.");
        } else {
            console.log(`Downloading ${total} post(s)...`);
        }

        let failedPosts: any[] = [];

        const runDownloadPass = async (postsToDl: any[], label: string) => {
            if (postsToDl.length === 0) return { saved: [], failed: [] as any[] };

            console.log(`${label}: downloading ${postsToDl.length} post(s)...`);

            return downloadPosts(postsToDl, username, {
                shouldStop: () => currentAbort,
                onProgress: ({ index, total: passTotal, shortcode, outcome }) => {
                    if (outcome.status === "saved") {
                        addToReviewQueue(outcome.metadata);
                        scraperState.collected++;
                        console.log(`[${label} ${index}/${passTotal}] ${shortcode} — saved`);
                    } else if (outcome.status === "failed") {
                        console.log(`[${label} ${index}/${passTotal}] ${shortcode} — failed (${outcome.reason})`);
                    } else {
                        console.log(`[${label} ${index}/${passTotal}] ${shortcode} — skipped (${outcome.reason})`);
                    }
                },
            });
        };

        const firstPass = await runDownloadPass(toDownload, "pass 1");
        failedPosts = firstPass.failed;

        if (failedPosts.length > 0 && !currentAbort) {
            console.log(`Retrying ${failedPosts.length} failed download(s) at end...`);
            await new Promise((r) => setTimeout(r, 1500));
            const retryPass = await runDownloadPass(failedPosts, "retry");
            failedPosts = retryPass.failed;
        }

        if (failedPosts.length > 0) {
            console.log(
                `Still failed after retry: ${failedPosts.map((p) => p.shortcode).join(", ")}`
            );
        }

        if (total > 0) {
            console.log(
                `Finished @${username}: ${scraperState.collected} new, ${total} processed`
            );
        }

        updateLastScraped(username);

        return cap;
    } finally {
        if (!page.isClosed()) {
            await page.close();
        }
        if (manageRunning) {
            scraperState.running = false;
            scraperState.currentUser = null;
            scraperState.mode = null;
        }
    }
}

export async function startScraping(
    username: string,
    target = 30,
    mode: ScrapeMode = "posts"
) {
    const user = normalizeUsername(username);
    return runScrapeForUser(user, target, { resetAbort: true, mode });
}

export type SubscriptionScrapeResult = {
    started: string[];
    pendingFirstTime: string[];
    skippedRunning?: boolean;
};

/** Scrape subscriptions with optional parallel workers. */
export async function startScrapingAllSubscriptions(
    target = 30,
    concurrency = 1,
    mode: ScrapeMode = "posts"
): Promise<SubscriptionScrapeResult> {
    const subs = getSubscriptions();

    if (subs.length === 0) {
        console.log("No subscriptions to scrape.");
        return { started: [], pendingFirstTime: [] };
    }

    if (scraperState.running) {
        return { started: [], pendingFirstTime: [], skippedRunning: true };
    }

    currentAbort = false;

    const neverScraped = subs.filter((s: any) => !s.lastScraped);
    const scrapedBefore = subs.filter((s: any) => s.lastScraped > 0);

    const queue =
        isUnlimitedTarget(target) ? scrapedBefore : subs;

    const pendingFirstTime = isUnlimitedTarget(target)
        ? neverScraped.map((s: any) => s.username)
        : [];

    const workerCount = Math.max(1, Math.floor(concurrency || 1));

    console.log(
        `Scraping ${queue.length} subscription(s) (target: ${isUnlimitedTarget(target) ? "unlimited" : target}, mode: ${mode})` +
        (pendingFirstTime.length ? `; ${pendingFirstTime.length} first-time pending click` : "") +
        ` with ${workerCount} worker(s)`
    );

    const started: string[] = [];

    scraperState.running = true;
    scraperState.mode = mode;

    // Pre-launch browser so parallel tabs share a ready context
    await launchBrowser({ startMinimized: workerCount === 1 });

    try {
        let index = 0;
        const activeUsers = new Set<string>();

        async function worker(workerIndex: number) {
            while (!currentAbort) {
                const next = queue[index++];
                if (!next) return;

                activeUsers.add(next.username);
                scraperState.currentUser = Array.from(activeUsers).join(", ");

                console.log(`--- Scraping: ${next.username} (worker ${workerIndex + 1}) ---`);
                started.push(next.username);

                try {
                    await runScrapeForUser(next.username, target, {
                        resetAbort: false,
                        manageRunningState: false,
                        mode,
                        workerIndex,
                    });
                } finally {
                    activeUsers.delete(next.username);
                    scraperState.currentUser = activeUsers.size
                        ? Array.from(activeUsers).join(", ")
                        : null;
                }
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(workerCount, queue.length) }, (_, i) => worker(i))
        );

        if (currentAbort) {
            console.log("Subscription scrape aborted.");
        }
    } finally {
        scraperState.running = false;
        scraperState.currentUser = null;
        scraperState.mode = null;
    }

    console.log("Subscription batch finished.");
    return { started, pendingFirstTime };
}

export function stopScraping() {
    currentAbort = true;
}

export function isScraperAbortRequested() {
    return currentAbort;
}
