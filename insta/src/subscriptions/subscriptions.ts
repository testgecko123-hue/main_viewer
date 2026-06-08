import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "subscriptions.json");

function ensure() {
    if (!fs.existsSync(FILE)) {
        fs.writeFileSync(FILE, "[]");
    }
}

export function getSubscriptions() {
    ensure();
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
}

export function addSubscription(username: string) {
    const subs = getSubscriptions();

    if (subs.find((s: any) => s.username === username)) {
        return;
    }

    subs.push({
        username,
        addedAt: Date.now(),
        lastScraped: 0
    });

    fs.writeFileSync(FILE, JSON.stringify(subs, null, 2));
}

export function updateLastScraped(username: string) {
    const subs = getSubscriptions();

    const sub = subs.find((s: any) => s.username === username);

    if (sub) {
        sub.lastScraped = Date.now();
        fs.writeFileSync(FILE, JSON.stringify(subs, null, 2));
    }
}