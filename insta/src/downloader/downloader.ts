import fs from "fs";
import path from "path";
import axios, { AxiosError } from "axios";

/** Parallel post downloads — keep low to avoid CDN resets */
export const DOWNLOAD_CONCURRENCY = 3;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 120_000;

const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.instagram.com/",
};

export type DownloadOutcome =
    | { status: "saved"; metadata: any }
    | { status: "skipped"; reason: string }
    | { status: "failed"; reason: string };

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
    const code =
        (err as AxiosError)?.code ??
        (err as NodeJS.ErrnoException)?.code ??
        "";

    const retryable = new Set([
        "ECONNRESET",
        "ECONNABORTED",
        "ETIMEDOUT",
        "EPIPE",
        "ENOTFOUND",
        "EAI_AGAIN",
    ]);

    if (retryable.has(code)) return true;

    const status = (err as AxiosError)?.response?.status;
    return status === 408 || status === 429 || (status !== undefined && status >= 500);
}

async function downloadBuffer(url: string, attempt = 1): Promise<Buffer> {
    try {
        const response = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: REQUEST_TIMEOUT_MS,
            headers: BROWSER_HEADERS,
            maxRedirects: 5,
            // Fresh connection per request — reused sockets often get ECONNRESET on CDNs
            httpAgent: undefined,
            httpsAgent: undefined,
        });

        return Buffer.from(response.data);
    } catch (err) {
        if (attempt < MAX_ATTEMPTS && isRetryableError(err)) {
            const delay = 400 * attempt;
            const code = (err as AxiosError)?.code ?? "error";
            console.log(`Download retry ${attempt + 1}/${MAX_ATTEMPTS} (${code}) in ${delay}ms`);
            await sleep(delay);
            return downloadBuffer(url, attempt + 1);
        }
        throw err;
    }
}

function postFolder(username: string, shortcode: string) {
    return path.join(process.cwd(), "data", "downloads", username, shortcode);
}

function removeIncompleteFolder(folder: string, metadataPath: string) {
    if (fs.existsSync(metadataPath)) return;
    try {
        if (fs.existsSync(folder)) {
            fs.rmSync(folder, { recursive: true, force: true });
        }
    } catch {
        /* ignore */
    }
}

export async function downloadPost(post: any, username: string): Promise<DownloadOutcome> {
    if (!post?.shortcode) {
        return { status: "skipped", reason: "missing shortcode" };
    }

    const folder = postFolder(username, post.shortcode);
    const metadataPath = path.join(folder, "metadata.json");

    if (fs.existsSync(metadataPath)) {
        return { status: "skipped", reason: "already downloaded" };
    }

    fs.mkdirSync(folder, { recursive: true });

    const metadata: any = {
        id: post.id,
        shortcode: post.shortcode,
        caption: post.caption || "",
        username,
        mediaType: post.mediaType,
        timestamp: post.timestamp ?? null,
    };

    try {
        if (post.mediaType === 1) {
            const url = post.image_versions2?.candidates?.find((c: any) => c?.url)?.url;
            if (!url) {
                removeIncompleteFolder(folder, metadataPath);
                return { status: "skipped", reason: "no image url" };
            }

            const filePath = path.join(folder, "media.jpg");
            fs.writeFileSync(filePath, await downloadBuffer(url));
            metadata.localFile = `downloads/${username}/${post.shortcode}/media.jpg`;
        } else if (post.mediaType === 2) {
            const url = post.video_versions?.find((v: any) => v?.url)?.url;
            if (!url) {
                removeIncompleteFolder(folder, metadataPath);
                return { status: "skipped", reason: "no video url" };
            }

            const filePath = path.join(folder, "video.mp4");
            fs.writeFileSync(filePath, await downloadBuffer(url));
            metadata.localFile = `downloads/${username}/${post.shortcode}/video.mp4`;
        } else if (post.mediaType === 8) {
            const children = post.carousel_media || [];
            const files: string[] = [];

            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                const videoUrl = child.video_versions?.find((v: any) => v?.url)?.url;
                const imageUrl = child.image_versions2?.candidates?.find((c: any) => c?.url)?.url;
                const url = videoUrl || imageUrl;
                const ext = videoUrl ? "mp4" : "jpg";

                if (!url) continue;

                const filePath = path.join(folder, `${i}.${ext}`);
                fs.writeFileSync(filePath, await downloadBuffer(url));
                files.push(`downloads/${username}/${post.shortcode}/${i}.${ext}`);
            }

            if (files.length === 0) {
                removeIncompleteFolder(folder, metadataPath);
                return { status: "skipped", reason: "carousel has no media urls" };
            }

            metadata.children = files;
        } else {
            removeIncompleteFolder(folder, metadataPath);
            return { status: "skipped", reason: "unknown media type" };
        }

        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        return { status: "saved", metadata };
    } catch (err: any) {
        removeIncompleteFolder(folder, metadataPath);
        const reason = err?.code ?? err?.message ?? String(err);
        console.log(`Download failed: ${post.shortcode} (${reason})`);
        return { status: "failed", reason };
    }
}

export async function downloadPosts(
    posts: any[],
    username: string,
    options?: {
        concurrency?: number;
        onProgress?: (info: {
            index: number;
            total: number;
            shortcode: string;
            outcome: DownloadOutcome;
        }) => void;
        shouldStop?: () => boolean;
    }
): Promise<{ saved: any[]; skipped: string[]; failed: any[] }> {
    const concurrency = Math.max(1, options?.concurrency ?? DOWNLOAD_CONCURRENCY);
    const saved: any[] = [];
    const skipped: string[] = [];
    const failed: any[] = [];

    let cursor = 0;
    const total = posts.length;

    async function worker() {
        while (cursor < total) {
            if (options?.shouldStop?.()) return;

            const index = cursor++;
            const post = posts[index];
            const outcome = await downloadPost(post, username);

            options?.onProgress?.({
                index: index + 1,
                total,
                shortcode: post.shortcode,
                outcome,
            });

            if (outcome.status === "saved") {
                saved.push(outcome.metadata);
            } else if (outcome.status === "failed") {
                failed.push(post);
            } else {
                skipped.push(post.shortcode);
            }
        }
    }

    const workers = Math.min(concurrency, Math.max(1, total));
    await Promise.all(Array.from({ length: workers }, () => worker()));

    return { saved, skipped, failed };
}
