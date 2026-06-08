import { BrowserContext, chromium } from "playwright";

let sharedContext: BrowserContext | null = null;
let pageCreateLock: Promise<void> = Promise.resolve();

type LaunchOptions = {
    startMinimized?: boolean;
};

export async function launchBrowser(options: LaunchOptions = {}) {
    const startMinimized = options.startMinimized ?? true;

    if (sharedContext) {
        return sharedContext;
    }

    sharedContext = await chromium.launchPersistentContext("./userdata", {
        headless: false,
        viewport: null,
        args: [startMinimized ? "--start-minimized" : "--start-maximized"],
    });

    sharedContext.on("close", () => {
        sharedContext = null;
    });

    return sharedContext;
}

/** Serialize newPage() calls to avoid races when running parallel workers. */
export async function newScrapePage(startMinimized = false) {
    const context = await launchBrowser({ startMinimized });
    let page;

    pageCreateLock = pageCreateLock.then(async () => {
        page = await context.newPage();
        await page.waitForTimeout(300);
    });
    await pageCreateLock;

    return page!;
}

export async function openManualInstagramWindow() {
    const page = await newScrapePage(false);
    await page.goto("about:blank", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });
    await page.goto("https://www.instagram.com/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
    });
    await page.bringToFront();
}

export function isBrowserOpen() {
    return Boolean(sharedContext);
}

export async function closeBrowser() {
    if (!sharedContext) return;
    await sharedContext.close();
    sharedContext = null;
}
