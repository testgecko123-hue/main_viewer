import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "rejected.json");

function ensure() {
    if (!fs.existsSync(FILE)) {
        fs.writeFileSync(FILE, "[]");
    }
}

export function getRejected(): string[] {
    ensure();
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
}

export function addRejected(shortcode: string) {
    const rejected = getRejected();

    if (!rejected.includes(shortcode)) {
        rejected.push(shortcode);
        fs.writeFileSync(FILE, JSON.stringify(rejected, null, 2));
    }
}

export function isRejected(shortcode: string): boolean {
    return getRejected().includes(shortcode);
}