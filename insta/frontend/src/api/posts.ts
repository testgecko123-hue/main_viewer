import axios from "axios";
import type { Post } from "../types/post";
import { API_URL } from "../config";

export async function fetchPosts(): Promise<Post[]> {
    const res = await axios.get(`${API_URL}/posts`);
    return res.data;
}

export async function deletePost(shortcode: string): Promise<void> {
    await axios.delete(`${API_URL}/posts/${encodeURIComponent(shortcode)}`);
}
