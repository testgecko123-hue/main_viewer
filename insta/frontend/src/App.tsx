import { useState } from "react";

import Library from "./pages/Library";
import Subscriptions from "./pages/Subscriptions";
import Review from "./pages/Review";
import SelectionPage from "./pages/Selection";
import Viewer from "./pages/Viewer";
import { SelectionProvider, useSelection } from "./context/SelectionContext";
import ErrorBoundary from "./components/ErrorBoundary";

function Nav({
    page,
    setPage,
}: {
    page: string;
    setPage: (p: string) => void;
}) {
    const { count } = useSelection();

    const links: { id: string; label: string; badge?: number }[] = [
        { id: "library", label: "Library" },
        { id: "subscriptions", label: "Subscriptions" },
        { id: "review", label: "Review" },
        { id: "selection", label: "Selection", badge: count },
        { id: "viewer", label: "Viewer" },
    ];

    return (
        <nav className="app-nav">
            <div className="app-nav__brand">
                insta<span>vault</span>
            </div>
            {links.map(({ id, label, badge }) => (
                <button
                    key={id}
                    type="button"
                    className={`nav-btn${page === id ? " nav-btn--active" : ""}`}
                    onClick={() => setPage(id)}
                >
                    {label}
                    {badge != null && badge > 0 ? ` (${badge})` : ""}
                </button>
            ))}
        </nav>
    );
}

function AppRoutes() {
    const [page, setPage] = useState("library");

    return (
        <div className="app-shell">
            <Nav page={page} setPage={setPage} />
            <main className="app-main">
                <ErrorBoundary>
                    {page === "library" && <Library />}
                    {page === "subscriptions" && <Subscriptions />}
                    {page === "review" && <Review />}
                    {page === "selection" && <SelectionPage />}
                    {page === "viewer" && <Viewer />}
                </ErrorBoundary>
            </main>
        </div>
    );
}

export default function App() {
    return (
        <SelectionProvider>
            <AppRoutes />
        </SelectionProvider>
    );
}
