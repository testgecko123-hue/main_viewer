import type { ScrapeMode } from "./profileScraper";

export const scraperState = {
    running: false,
    currentUser: null as string | null,
    target: 0,
    collected: 0,
    mode: null as ScrapeMode | null,
};

export function resetScraperProgress() {
    scraperState.target = 0;
    scraperState.collected = 0;
}
