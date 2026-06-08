import fs from "fs";
import path from "path";

/** Collect shortcodes already on disk for a user (downloads folder). */
export function getKnownShortcodes(username: string): Set<string> {
    const dir = path.join(process.cwd(), "data", "downloads", username.toLowerCase());
    const known = new Set<string>();
    if (!fs.existsSync(dir)) return known;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(dir, entry.name, "metadata.json");
        if (fs.existsSync(metaPath)) {
            known.add(entry.name);
        }
    }
    return known;
}
