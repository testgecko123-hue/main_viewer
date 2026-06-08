import { launchBrowser } from "./browser/browser";
import { scrapeProfile } from "./scraper/profileScraper";
import { downloadPost } from "./downloader/downloader";

async function main() {

    const context = await launchBrowser();

    const page = context.pages()[0] || await context.newPage();

    const posts = await scrapeProfile(
        page,
        "nasa",
        10
    );

    console.log(`Collected ${posts.length} posts`);

    for (const post of posts) {

        if (!post.imageUrl) {
            continue;
        }

        await downloadPost(post, "nasa");
    }

    console.log("Finished.");
}

main().catch(console.error);