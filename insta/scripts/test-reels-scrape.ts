/**
 * Standalone test for reels scraping.
 * Usage: npx ts-node scripts/test-reels-scrape.ts <username> [limit]
 */
import { launchBrowser, closeBrowser } from "../src/browser/browser";
import { scrapeReels } from "../src/scraper/reelsScraper";
import { getKnownShortcodes } from "../src/scraper/knownPosts";

async function main() {
    const username = (process.argv[2] || "").trim().replace(/^@/, "");
    const limitArg = process.argv[3];
    const limit = limitArg ? Number(limitArg) : 15;

    if (!username) {
        console.error("Usage: npx ts-node scripts/test-reels-scrape.ts <username> [limit]");
        process.exit(1);
    }

    console.log(`Testing reels scrape for @${username} (limit: ${limit})`);

    const context = await launchBrowser({ startMinimized: false });
    const page = await context.newPage();

    try {
        const known = getKnownShortcodes(username);
        console.log(`Known shortcodes on disk: ${known.size}`);

        const reels = await scrapeReels(page, username, {
            targetPosts: limit,
            knownShortcodes: known,
            scrollWaitMs: 1500,
            maxNoNew: 3,
        });

        console.log(`\nFound ${reels.length} reel(s):`);
        for (const r of reels) {
            const tag = known.has(r.shortcode) ? "known" : "NEW";
            console.log(`  ${r.shortcode} (${tag})`);
        }
    } finally {
        if (!page.isClosed()) await page.close();
        await closeBrowser();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
