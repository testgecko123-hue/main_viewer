import SubscriptionManager from "../components/SubscriptionManager";
import SubscriptionFeed from "../components/SubscriptionFeed";

export default function Subscriptions() {
    return (
        <div className="page">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Subscriptions</h1>
                    <p className="page-subtitle">Accounts to scrape on a schedule</p>
                </div>
            </header>
            <SubscriptionManager />
            <SubscriptionFeed />
        </div>
    );
}
