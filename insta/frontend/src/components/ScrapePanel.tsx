import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../config";

export default function ScrapePanel() {
    const [username, setUsername] = useState("");
    const [limit, setLimit] = useState(30);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState("");
    const [mode, setMode] = useState<"posts" | "reels">("posts");

    useEffect(() => {
        const interval = setInterval(checkStatus, 2000);
        return () => clearInterval(interval);
    }, []);

    async function checkStatus() {
        const res = await axios.get(`${API_URL}/scrape/status`);
        setRunning(res.data.running);
        if (res.data.running && res.data.currentUser) {
            const t =
                res.data.target < 0
                    ? "unlimited"
                    : `up to ${res.data.target} posts`;
            setStatus(`@${res.data.currentUser} · ${t}`);
        } else if (!res.data.running) {
            setStatus("");
        }
    }

    async function start() {
        const clean = username.trim().replace(/^@/, "");
        await axios.post(`${API_URL}/scrape/start`, {
            username: clean,
            limit,
            mode,
        });
        setRunning(true);
    }

    async function stop() {
        await axios.post(`${API_URL}/scrape/stop`);
        setRunning(false);
    }

    return (
        <div className="scrape-panel">
            <div className="btn-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
                <input
                    placeholder="@username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !running && username && start()}
                />
                <label style={{ fontSize: 13, color: "var(--text-2)" }}>
                    Limit
                    <input
                        type="number"
                        value={limit}
                        min={-1}
                        max={500}
                        onChange={(e) => setLimit(Number(e.target.value))}
                        style={{ marginLeft: 8, width: 64 }}
                        disabled={running}
                    />
                </label>
                <label style={{ fontSize: 13, color: "var(--text-2)" }}>
                    Scrape
                    <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as "posts" | "reels")}
                        style={{ marginLeft: 8 }}
                        disabled={running}
                    >
                        <option value="posts">Posts only</option>
                        <option value="reels">Reels only</option>
                    </select>
                </label>
                {!running ? (
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={start}
                        disabled={!username.trim()}
                    >
                        Start scrape
                    </button>
                ) : (
                    <button type="button" className="btn btn--danger" onClick={stop}>
                        Stop
                    </button>
                )}
                {status && (
                    <span
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 12,
                            color: "var(--accent)",
                        }}
                    >
                        {status}
                    </span>
                )}
            </div>
        </div>
    );
}
