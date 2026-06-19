import { useCallback, useEffect, useState } from "react";

const MIN_COL_WIDTH = 180;
const GRID_GAP = 12;
const GRID_PAD_X = 40;
const CAPTION_HEIGHT = 38;
const OVERSCAN_ROWS = 2;

export type VirtualGridRange = {
    start: number;
    end: number;
    topSpacer: number;
    bottomSpacer: number;
    enabled: boolean;
};

function colCountForWidth(width: number): number {
    return Math.max(1, Math.floor((width - GRID_PAD_X + GRID_GAP) / (MIN_COL_WIDTH + GRID_GAP)));
}

function rowHeightForWidth(width: number, colCount: number): number {
    const cellWidth = (width - GRID_PAD_X - GRID_GAP * (colCount - 1)) / colCount;
    return cellWidth + CAPTION_HEIGHT + GRID_GAP;
}

function computeRange(
    itemCount: number,
    width: number,
    gridTop: number,
    scrollTop: number,
    viewportHeight: number
): VirtualGridRange {
    if (itemCount === 0) {
        return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0, enabled: false };
    }

    const colCount = colCountForWidth(width);
    const rowHeight = rowHeightForWidth(width, colCount);
    const rowCount = Math.ceil(itemCount / colCount);

    const gridBottom = gridTop + rowCount * rowHeight - GRID_GAP;
    const viewportBottom = scrollTop + viewportHeight;

    if (viewportBottom < gridTop || scrollTop > gridBottom) {
        const end = Math.min(itemCount, colCount * (OVERSCAN_ROWS + 3));
        return {
            start: 0,
            end,
            topSpacer: 0,
            bottomSpacer: Math.max(0, (rowCount - Math.ceil(end / colCount)) * rowHeight),
            enabled: true,
        };
    }

    const relativeTop = scrollTop - gridTop;
    const relativeBottom = viewportBottom - gridTop;

    const startRow = Math.max(0, Math.floor(relativeTop / rowHeight) - OVERSCAN_ROWS);
    const endRow = Math.min(
        rowCount - 1,
        Math.ceil(relativeBottom / rowHeight) + OVERSCAN_ROWS
    );

    const start = startRow * colCount;
    const end = Math.min(itemCount, (endRow + 1) * colCount);

    return {
        start,
        end,
        topSpacer: startRow * rowHeight,
        bottomSpacer: Math.max(0, (rowCount - endRow - 1) * rowHeight),
        enabled: true,
    };
}

function initialRange(itemCount: number, enabled: boolean): VirtualGridRange {
    if (!enabled || itemCount === 0) {
        return {
            start: 0,
            end: itemCount,
            topSpacer: 0,
            bottomSpacer: 0,
            enabled: false,
        };
    }

    const width = typeof window !== "undefined" ? window.innerWidth : 1200;
    const colCount = colCountForWidth(width);
    const rowHeight = rowHeightForWidth(width, colCount);
    const end = Math.min(itemCount, colCount * 5);
    const rowCount = Math.ceil(itemCount / colCount);

    return {
        start: 0,
        end,
        topSpacer: 0,
        bottomSpacer: Math.max(0, (rowCount - Math.ceil(end / colCount)) * rowHeight),
        enabled: true,
    };
}

export function useVirtualGrid(
    itemCount: number,
    containerRef: React.RefObject<HTMLElement | null>,
    enabled: boolean
): VirtualGridRange {
    const [range, setRange] = useState<VirtualGridRange>(() =>
        initialRange(itemCount, enabled)
    );

    const update = useCallback(() => {
        const el = containerRef.current;
        if (!el || !enabled || itemCount === 0) {
            setRange({
                start: 0,
                end: itemCount,
                topSpacer: 0,
                bottomSpacer: 0,
                enabled: false,
            });
            return;
        }

        const rect = el.getBoundingClientRect();
        const gridTop = rect.top + window.scrollY;
        const width = el.clientWidth || window.innerWidth;

        setRange(
            computeRange(
                itemCount,
                width,
                gridTop,
                window.scrollY,
                window.innerHeight
            )
        );
    }, [containerRef, enabled, itemCount]);

    useEffect(() => {
        if (!enabled) {
            setRange({
                start: 0,
                end: itemCount,
                topSpacer: 0,
                bottomSpacer: 0,
                enabled: false,
            });
            return;
        }

        update();

        let raf = 0;
        const onScroll = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                update();
            });
        };

        const observer = new ResizeObserver(onScroll);
        if (containerRef.current) observer.observe(containerRef.current);

        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });

        return () => {
            if (raf) cancelAnimationFrame(raf);
            observer.disconnect();
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
        };
    }, [containerRef, enabled, itemCount, update]);

    return range;
}
