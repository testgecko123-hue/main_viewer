import axios from "axios";
import type { Subscription } from "../utils/discoveryFeed";
import { API_URL } from "../config";

export async function fetchSubscriptions(): Promise<Subscription[]> {
    const res = await axios.get(`${API_URL}/subscriptions`);
    return res.data;
}
