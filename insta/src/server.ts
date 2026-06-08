import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { startScraping, startScrapingAllSubscriptions, stopScraping } from "./scraper/controller";
import { closeBrowser, isBrowserOpen, openManualInstagramWindow } from "./browser/browser";
import { scraperState } from "./scraper/state";
import { getSubscriptions, addSubscription } from "./subscriptions/subscriptions";
import { getPosts, savePosts, removePost, deletePostFiles } from "./storage/posts";
import { getStoredSelection, saveStoredSelection } from "./storage/selection";
import type { ScrapeMode } from "./scraper/profileScraper";
import { getReviewQueue, removeFromReviewQueue } from "./subscriptions/reviewQueue";
import { addRejected } from "./subscriptions/rejectedPosts";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 3847;

// -------------------------
// POSTS
// -------------------------

app.get("/posts", (req, res) => {
    res.json(getPosts());
});

app.delete("/posts/:shortcode", (req, res) => {
    const { shortcode } = req.params;

    if (!shortcode) {
        return res.status(400).json({ error: "Missing shortcode" });
    }

    const removed = removePost(shortcode);

    if (!removed) {
        return res.status(404).json({ error: "Post not found" });
    }

    res.json({ success: true });
});

// -------------------------
// MEDIA
// -------------------------

app.use(
    "/downloads",
    express.static(path.join(process.cwd(), "data", "downloads"))
);

// -------------------------
// SCRAPER
// -------------------------

function parseScrapeMode(raw: unknown): ScrapeMode | null {
    if (raw === "posts" || raw === "reels") return raw;
    return null;
}

app.post("/scrape/start", async (req, res) => {
    const { username, limit, mode: rawMode } = req.body;

    if (!username) {
        return res.status(400).json({ error: "Missing username" });
    }

    if (scraperState.running) {
        return res.status(409).json({ error: "Scraper already running" });
    }

    const target =
        limit !== undefined && limit !== null ? Number(limit) : 30;

    if (Number.isNaN(target) || (target !== -1 && target < 1)) {
        return res.status(400).json({ error: "Invalid limit (use -1 or a positive number)" });
    }

    const mode = parseScrapeMode(rawMode) ?? "posts";
    const cleanUser = String(username).trim().replace(/^@/, "");

    console.log("Starting scrape:", cleanUser, "limit:", target, "mode:", mode);

    startScraping(cleanUser, target, mode).catch((err) => {
        console.error("Scrape failed:", err);
    });

    res.json({ status: "started", username: cleanUser, limit: target, mode });
});

app.post("/scrape/stop", (req, res) => {
    console.log("Stopping scrape");
    stopScraping();
    res.json({ status: "stopped" });
});

app.get("/scrape/status", (req, res) => {
    res.json(scraperState);
});

app.get("/browser/status", (req, res) => {
    res.json({ open: isBrowserOpen() });
});

app.post("/browser/open", async (req, res) => {
    if (scraperState.running) {
        return res.status(409).json({ error: "Scraper is running. Stop it before manual browser control." });
    }

    try {
        await openManualInstagramWindow();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Could not open browser window" });
    }
});

app.post("/browser/close", async (req, res) => {
    try {
        await closeBrowser();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Could not close browser window" });
    }
});

// -------------------------
// SUBSCRIPTIONS
// -------------------------

app.get("/subscriptions", (req, res) => {
    res.json(getSubscriptions());
});

app.post("/subscriptions", (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ error: "Missing username" });
    }

    addSubscription(username);

    res.json({ success: true });
});

// Scrape all subscriptions in sequence
app.post("/subscriptions/scrape", (req, res) => {
    if (scraperState.running) {
        return res.status(409).json({ error: "Scraper already running" });
    }

    const subs = getSubscriptions();

    if (subs.length === 0) {
        return res.status(400).json({ error: "No subscriptions added yet" });
    }

    const limit =
        req.body?.limit !== undefined && req.body?.limit !== null
            ? Number(req.body.limit)
            : 30;
    const concurrency =
        req.body?.concurrency !== undefined && req.body?.concurrency !== null
            ? Number(req.body.concurrency)
            : 1;
    const mode = parseScrapeMode(req.body?.mode) ?? "posts";

    if (Number.isNaN(limit) || (limit !== -1 && limit < 1)) {
        return res.status(400).json({ error: "Invalid limit (use -1 or a positive number)" });
    }
    if (Number.isNaN(concurrency) || concurrency < 1 || concurrency > 8) {
        return res.status(400).json({ error: "Invalid concurrency (use 1-8)" });
    }

    const neverScraped = subs.filter((s: any) => !s.lastScraped);
    const scrapedBefore = subs.filter((s: any) => s.lastScraped > 0);
    const unlimited = limit < 0;

    const pendingFirstTime = unlimited
        ? neverScraped.map((s: any) => s.username)
        : [];

    const queueCount = unlimited ? scrapedBefore.length : subs.length;

    console.log("Starting subscription scrape, limit:", limit, "mode:", mode);

    startScrapingAllSubscriptions(limit, concurrency, mode).catch((err) => {
        console.error("Subscription scrape failed:", err);
    });

    res.json({
        status: "started",
        limit,
        concurrency,
        mode,
        pendingFirstTime,
        count: queueCount,
    });
});

// -------------------------
// SELECTION PERSISTENCE
// -------------------------

app.get("/selection", (req, res) => {
    res.json(getStoredSelection());
});

function handleSaveSelection(req: express.Request, res: express.Response) {
    const raw = req.body?.shortcodes;
    if (!Array.isArray(raw)) {
        return res.status(400).json({ error: "shortcodes must be an array" });
    }
    const shortcodes = raw.filter((s: unknown) => typeof s === "string");
    const saved = saveStoredSelection(shortcodes);
    res.json(saved);
}

app.put("/selection", handleSaveSelection);
app.post("/selection", handleSaveSelection);

// -------------------------
// REVIEW QUEUE
// -------------------------

app.get("/review", (req, res) => {
    res.json(getReviewQueue());
});

app.post("/review/accept", (req, res) => {
    const { shortcode } = req.body;

    const queue = getReviewQueue();

    const post = queue.find((p: any) => p.shortcode === shortcode);

    if (!post) {
        return res.status(404).json({ error: "Post not found" });
    }

    const posts = getPosts();

    const exists = posts.find((p: any) => p.shortcode === shortcode);

    if (!exists) {
        posts.push({
            ...post,
            timestamp: post.timestamp ?? null,
            savedAt: Date.now(),
        });
        savePosts(posts);
    }

    removeFromReviewQueue(shortcode);

    res.json({ success: true });
});

app.post("/review/reject", (req, res) => {
    const { shortcode } = req.body;

    const queue = getReviewQueue();

    const post = queue.find((p: any) => p.shortcode === shortcode);

    if (!post) {
        return res.status(404).json({ error: "Post not found" });
    }

    // Persist the rejection so this post never reappears in future scrapes
    addRejected(shortcode);

    removeFromReviewQueue(shortcode);

    if (post.username && post.shortcode) {
        deletePostFiles(post.username, post.shortcode);
    }

    res.json({ success: true });
});

app.post("/review/remove", (req, res) => {
    const { shortcode } = req.body;
    removeFromReviewQueue(shortcode);
    res.json({ success: true });
});

// -------------------------

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});