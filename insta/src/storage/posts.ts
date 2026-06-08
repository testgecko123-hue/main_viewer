import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "posts.json");
const DOWNLOADS = path.join(process.cwd(), "data", "downloads");

function ensure() {
    if (!fs.existsSync(FILE)) {
        fs.writeFileSync(FILE, "[]");
    }
}

function metadataPath(username: string, shortcode: string) {
    return path.join(DOWNLOADS, username, shortcode, "metadata.json");
}

/** Fill missing timestamp / savedAt from on-disk metadata when possible. */
export function enrichPost(post: any): any {
    const enriched = { ...post };

    const metaFile = post.username && post.shortcode
        ? metadataPath(post.username, post.shortcode)
        : null;

    if (metaFile && fs.existsSync(metaFile)) {
        try {
            const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
            if (enriched.timestamp == null && meta.timestamp != null) {
                enriched.timestamp = meta.timestamp;
            }
        } catch {
            /* ignore corrupt metadata */
        }

        if (enriched.savedAt == null) {
            try {
                enriched.savedAt = fs.statSync(metaFile).mtimeMs;
            } catch {
                /* ignore */
            }
        }
    }

    return enriched;
}

export function getPosts() {
    ensure();
    const posts = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return posts.map(enrichPost);
}

export function savePosts(posts: any[]) {
    ensure();
    fs.writeFileSync(FILE, JSON.stringify(posts, null, 2));
}

export function deletePostFiles(username: string, shortcode: string) {
    const folder = path.join(DOWNLOADS, username, shortcode);

    try {
        if (fs.existsSync(folder)) {
            fs.rmSync(folder, { recursive: true, force: true });
        }
    } catch (err) {
        console.log("Could not delete folder:", folder, err);
    }
}

export function removePost(shortcode: string): boolean {
    const posts = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    const post = posts.find((p: any) => p.shortcode === shortcode);

    if (!post) {
        return false;
    }

    const filtered = posts.filter((p: any) => p.shortcode !== shortcode);
    savePosts(filtered);

    if (post.username && post.shortcode) {
        deletePostFiles(post.username, post.shortcode);
    }

    return true;
}
