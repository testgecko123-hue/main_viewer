import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../config";

type Sub = {
    username: string;
    lastScraped: number;
};

export default function SubscriptionManager() {
    const [subs, setSubs] = useState<Sub[]>([]);
    const [username, setUsername] = useState("");
    const [scrapingUser, setScrapingUser] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [statusText, setStatusText] = useState("");
    const [errorText, setErrorText] = useState("");
    const [browserOpen, setBrowserOpen] = useState(false);
    const [browserBusy, setBrowserBusy] = useState(false);
    const [scrapeMode, setScrapeMode] = useState<"posts" | "reels">("posts");

    async function load() {
        const res = await axios.get(`${API_URL}/subscriptions`);
        setSubs(res.data);
    }

    async function pollRunning() {
        try {
            const res = await axios.get(`${API_URL}/scrape/status`);
            const browser = await axios.get(`${API_URL}/browser/status`);
            const isRunning = res.data.running;
            setBrowserOpen(Boolean(browser.data.open));
            setRunning(isRunning);

            if (isRunning && res.data.currentUser) {
                const label =
                    res.data.target < 0
                        ? "unlimited"
                        : `target ${res.data.target}`;
                setStatusText(`Scraping @${res.data.currentUser} (${label})`);
                setScrapingUser(res.data.currentUser);
            } else if (!isRunning) {
                if (scrapingUser) {
                    load();
                }
                setScrapingUser(null);
                if (!errorText) {
                    setStatusText("");
                }
            }
        } catch {
            /* ignore */
        }
    }

    useEffect(() => {
        load();
        const interval = setInterval(pollRunning, 1500);
        return () => clearInterval(interval);
    }, []);

    async function add() {
        if (!username.trim()) return;
        await axios.post(`${API_URL}/subscriptions`, {
            username: username.trim().replace(/^@/, ""),
        });
        setUsername("");
        load();
    }

    async function scrapeOne(user: string) {
        setErrorText("");

        try {
            const status = await axios.get(`${API_URL}/scrape/status`);
            if (status.data.running) {
                setErrorText(
                    `Scraper is busy with @${status.data.currentUser}. Stop it first or wait.`
                );
                return;
            }

            setScrapingUser(user);
            await axios.post(`${API_URL}/scrape/start`, {
                username: user,
                limit: -1,
                mode: scrapeMode,
            });
            setRunning(true);
            setStatusText(`Starting unlimited scrape for @${user}…`);
        } catch (err: any) {
            setScrapingUser(null);
            setErrorText(
                err.response?.data?.error ?? `Could not start scrape for @${user}`
            );
        }
    }

    async function stopScrape() {
        await axios.post(`${API_URL}/scrape/stop`);
        setStatusText("Stopping…");
    }

    async function openBrowserWindow() {
        setBrowserBusy(true);
        setErrorText("");
        try {
            await axios.post(`${API_URL}/browser/open`);
            setBrowserOpen(true);
            setStatusText("Instagram window opened for manual testing.");
        } catch (err: any) {
            setErrorText(err.response?.data?.error ?? "Could not open browser window");
        } finally {
            setBrowserBusy(false);
        }
    }

    async function closeBrowserWindow() {
        setBrowserBusy(true);
        setErrorText("");
        try {
            await axios.post(`${API_URL}/browser/close`);
            setBrowserOpen(false);
            setStatusText("Manual browser window closed.");
        } catch (err: any) {
            setErrorText(err.response?.data?.error ?? "Could not close browser window");
        } finally {
            setBrowserBusy(false);
        }
    }

    return (
        <div className="scrape-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Subscriptions</h2>
                {running && (
                    <button type="button" className="btn btn--danger" onClick={stopScrape}>
                        Stop scrape
                    </button>
                )}
            </div>

            <div className="btn-row" style={{ alignItems: "center", marginBottom: 12 }}>
                <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="@username"
                    onKeyDown={(e) => e.key === "Enter" && add()}
                    disabled={running}
                />
                <button type="button" className="btn btn--primary" onClick={add} disabled={running}>
                    Add
                </button>
            </div>
            <div className="btn-row" style={{ alignItems: "center", marginBottom: 16 }}>
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={running || browserBusy}
                    onClick={openBrowserWindow}
                >
                    Open Instagram window
                </button>
                <button
                    type="button"
                    className="btn"
                    disabled={browserBusy || !browserOpen}
                    onClick={closeBrowserWindow}
                >
                    Close window
                </button>
            </div>

            {(statusText || errorText) && (
                <p
                    style={{
                        margin: "0 0 12px",
                        fontSize: 12,
                        fontFamily: "var(--font-mono)",
                        color: errorText ? "var(--danger)" : "var(--accent)",
                    }}
                >
                    {errorText || statusText}
                </p>
            )}

            <div className="btn-row" style={{ alignItems: "center", marginBottom: 10 }}>
                <label style={{ fontSize: 12, color: "var(--text-2)" }}>
                    Scrape
                    <select
                        value={scrapeMode}
                        onChange={(e) => setScrapeMode(e.target.value as "posts" | "reels")}
                        style={{ marginLeft: 8 }}
                        disabled={running}
                    >
                        <option value="posts">Posts only</option>
                        <option value="reels">Reels only</option>
                    </select>
                </label>
            </div>

            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-3)" }}>
                Click an account to scrape it only (−1 / unlimited scroll).
            </p>

            <ul className="sub-list">
                {subs.map((sub) => {
                    const isActive = scrapingUser === sub.username && running;
                    const isNew = !sub.lastScraped;

                    return (
                        <li key={sub.username} className="sub-list__item">
                            <button
                                type="button"
                                className="sub-list__user sub-list__user--clickable"
                                disabled={running && !isActive}
                                onClick={() => scrapeOne(sub.username)}
                                title="Scrape this account only (unlimited)"
                            >
                                @{sub.username}
                                {isNew && <span className="sub-list__badge">new</span>}
                                {isActive && (
                                    <span className="sub-list__badge sub-list__badge--active">
                                        …
                                    </span>
                                )}
                            </button>
                            <span className="sub-list__hint">
                                {isNew
                                    ? "never scraped"
                                    : `last ${new Date(sub.lastScraped).toLocaleDateString()}`}
                            </span>
                        </li>
                    );
                })}
                {subs.length === 0 && (
                    <li className="sub-list__empty">No subscriptions yet</li>
                )}
            </ul>
        </div>
    );
}
