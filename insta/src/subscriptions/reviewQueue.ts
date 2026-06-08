import fs from "fs";
import path from "path";
import { isRejected } from "./rejectedPosts";

const FILE = path.join(process.cwd(), "data", "reviewQueue.json");

function ensureFile() {
    if (!fs.existsSync(FILE)) {
        fs.writeFileSync(FILE, "[]");
    }
}

export function getReviewQueue() {
    ensureFile();
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
}

export function addToReviewQueue(post: any) {
    // downloadPost returns null for skipped/failed posts
    if (!post?.shortcode) return;

    // Never re-queue a post the user has already rejected
    if (isRejected(post.shortcode)) return;

    const queue = getReviewQueue();

    const exists = queue.find((p: any) => p.shortcode === post.shortcode);
    if (exists) return;

    queue.push(post);

    fs.writeFileSync(FILE, JSON.stringify(queue, null, 2));
}

export function removeFromReviewQueue(shortcode: string) {
    const queue = getReviewQueue();

    const filtered = queue.filter(
        (p: any) => p.shortcode !== shortcode
    );

    fs.writeFileSync(FILE, JSON.stringify(filtered, null, 2));
}