import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../config";

type ScrapeMode = "posts" | "reels";

export default function SubscriptionFeed() {
    const [limit, setLimit] = useState(30);
    const [concurrency, setConcurrency] = useState(1);
    const [mode, setMode] = useState<ScrapeMode>("posts");
    const [busy, setBusy] = useState(false);
    const [running, setRunning] = useState(false);
    const [pendingFirstTime, setPendingFirstTime] = useState<string[]>([]);
    const [statusText, setStatusText] = useState("");

    const unlimited = limit === -1;

    useEffect(() => {
        const interval = setInterval(pollStatus, 2000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!unlimited) {
            setPendingFirstTime([]);
            return;
        }
        axios
            .get(`${API_URL}/subscriptions`)
            .then((res) => {
                const pending = (res.data as { username: string; lastScraped: number }[])
                    .filter((s) => !s.lastScraped)
                    .map((s) => s.username);
                setPendingFirstTime(pending);
            })
            .catch(() => {});
    }, [unlimited]);

    async function pollStatus() {
        try {
            const res = await axios.get(`${API_URL}/scrape/status`);
            setRunning(res.data.running);
            if (res.data.running && res.data.currentUser) {
                const targetLabel =
                    res.data.target < 0
                        ? "∞"
                        : `${res.data.collected ?? 0} queued · target ${res.data.target}`;
                setStatusText(`Scraping @${res.data.currentUser} (${targetLabel})`);
            } else if (!res.data.running && statusText.startsWith("Scraping")) {
                setStatusText("");
            }
        } catch {
            /* server offline */
        }
    }

    async function scrapeAll() {
        setBusy(true);
        try {
            const res = await axios.post(`${API_URL}/subscriptions/scrape`, {
                limit,
                concurrency,
                mode,
            });
            setPendingFirstTime(res.data.pendingFirstTime ?? []);
            setRunning(true);
            if (unlimited && res.data.pendingFirstTime?.length) {
                setStatusText(
                    `Batch started for ${res.data.count} account(s). Click a new @user below to scrape them.`
                );
            }
        } catch (err: any) {
            setStatusText(err.response?.data?.error ?? "Could not start scrape");
        } finally {
            setBusy(false);
        }
    }

    async function scrapeOne(username: string) {
        setBusy(true);
        setStatusText("");
        try {
            const status = await axios.get(`${API_URL}/scrape/status`);
            if (status.data.running) {
                setStatusText(
                    `Scraper busy with @${status.data.currentUser}. Stop it first.`
                );
                return;
            }

            await axios.post(`${API_URL}/scrape/start`, {
                username,
                limit: -1,
                mode,
            });
            setRunning(true);
            setStatusText(`Scraping @${username}…`);
            setPendingFirstTime((prev) => prev.filter((u) => u !== username));
        } catch (err: any) {
            setStatusText(err.response?.data?.error ?? `Could not scrape @${username}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="scrape-panel subscription-feed" style={{ marginTop: 0 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>Scrape all</h2>
            <div className="btn-row" style={{ alignItems: "center" }}>
                <label style={{ fontSize: 13, color: "var(--text-2)" }}>
                    Posts per account
                    <input
                        type="number"
                        value={limit}
                        min={-1}
                        max={500}
                        onChange={(e) => setLimit(Number(e.target.value))}
                        style={{ marginLeft: 10, width: 72 }}
                    />
                </label>
                <label style={{ fontSize: 13, color: "var(--text-2)" }}>
                    Parallel windows
                    <input
                        type="number"
                        value={concurrency}
                        min={1}
                        max={8}
                        onChange={(e) => setConcurrency(Number(e.target.value))}
                        style={{ marginLeft: 10, width: 60 }}
                    />
                </label>
                <label style={{ fontSize: 13, color: "var(--text-2)" }}>
                    Scrape
                    <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as ScrapeMode)}
                        style={{ marginLeft: 10 }}
                        disabled={running}
                    >
                        <option value="posts">Posts only</option>
                        <option value="reels">Reels only</option>
                    </select>
                </label>
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={scrapeAll}
                    disabled={busy || running}
                >
                    {busy ? "Starting…" : "Scrape subscriptions"}
                </button>
            </div>

            <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-3)" }}>
                {unlimited
                    ? "−1 = unlimited scroll per account. New subscriptions must be started individually (click @user below)."
                    : "Runs each subscription in order and stops after the post count is reached."}
            </p>

            {statusText && (
                <p
                    style={{
                        margin: "10px 0 0",
                        fontSize: 12,
                        fontFamily: "var(--font-mono)",
                        color: "var(--accent)",
                    }}
                >
                    {statusText}
                </p>
            )}

            {unlimited && pendingFirstTime.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                        First-time accounts — click to scrape only that user:
                    </p>
                    <div className="btn-row">
                        {pendingFirstTime.map((user) => (
                            <button
                                key={user}
                                type="button"
                                className="btn btn--primary"
                                disabled={running || busy}
                                onClick={() => scrapeOne(user)}
                            >
                                @{user}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
