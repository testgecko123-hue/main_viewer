import fs from "fs";
import path from "path";

const SELECTION_PATH = path.join(process.cwd(), "data", "selection.json");

export type StoredSelection = {
    shortcodes: string[];
    updatedAt: number;
};

function ensureDir() {
    const dir = path.dirname(SELECTION_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getStoredSelection(): StoredSelection {
    ensureDir();
    if (!fs.existsSync(SELECTION_PATH)) {
        return { shortcodes: [], updatedAt: 0 };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(SELECTION_PATH, "utf8"));
        const shortcodes = Array.isArray(raw.shortcodes)
            ? raw.shortcodes.filter((s: unknown) => typeof s === "string")
            : [];
        return {
            shortcodes,
            updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
        };
    } catch {
        return { shortcodes: [], updatedAt: 0 };
    }
}

export function saveStoredSelection(shortcodes: string[]) {
    ensureDir();
    const data: StoredSelection = {
        shortcodes: [...new Set(shortcodes)],
        updatedAt: Date.now(),
    };
    fs.writeFileSync(SELECTION_PATH, JSON.stringify(data, null, 2));
    return data;
}
