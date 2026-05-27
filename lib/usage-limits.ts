export const DAILY_FREE_DOWNLOAD_LIMIT = 50;
export const DAILY_FREE_TRANSLATE_LIMIT = 50;

function getTodayString() {
    return new Date().toISOString().split("T")[0];
}

export function checkAndIncrementUsage(
    type: "download" | "translate",
    amount: number = 1,
    isVip: boolean = false
): boolean {
    if (isVip) return true; // VIP uses unrestricted

    const limit = type === "download" ? DAILY_FREE_DOWNLOAD_LIMIT : DAILY_FREE_TRANSLATE_LIMIT;
    const key = `novel_studio_usage_${type}_${getTodayString()}`;

    const currentStr = localStorage.getItem(key) || "0";
    let currentUsage = parseInt(currentStr, 10);

    if (currentUsage + amount > limit) {
        return false; // Blocks the execution
    }

    currentUsage += amount;
    localStorage.setItem(key, currentUsage.toString());
    return true;
}

export function getRemainingUsage(type: "download" | "translate", isVip: boolean = false): number {
    if (isVip) return 999999;

    const limit = type === "download" ? DAILY_FREE_DOWNLOAD_LIMIT : DAILY_FREE_TRANSLATE_LIMIT;
    const key = `novel_studio_usage_${type}_${getTodayString()}`;

    const currentStr = localStorage.getItem(key) || "0";
    const currentUsage = parseInt(currentStr, 10);

    return Math.max(0, limit - currentUsage);
}

export const DAILY_VIP_RR_DOWNLOAD_LIMIT = 10;

export function checkAndIncrementVipUsage(type: "rr_download", amount: number = 1): boolean {
    const key = `novel_studio_usage_vip_${type}_${getTodayString()}`;
    const currentStr = localStorage.getItem(key) || "0";
    let currentUsage = parseInt(currentStr, 10);

    if (currentUsage + amount > DAILY_VIP_RR_DOWNLOAD_LIMIT) {
        return false;
    }

    currentUsage += amount;
    localStorage.setItem(key, currentUsage.toString());
    return true;
}

export function getRemainingVipUsage(type: "rr_download"): number {
    const key = `novel_studio_usage_vip_${type}_${getTodayString()}`;
    const currentStr = localStorage.getItem(key) || "0";
    const currentUsage = parseInt(currentStr, 10);
    return Math.max(0, DAILY_VIP_RR_DOWNLOAD_LIMIT - currentUsage);
}
