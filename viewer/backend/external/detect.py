"""External URL detection and normalization."""

import re
from urllib.parse import urlparse

def normalize_url(url):
    """Normalize URL for consistent storage."""
    url = url.strip()
    if not url:
        return url
    # Remove trailing slashes
    url = url.rstrip('/')
    return url

def detect_url_kind(url):
    """
    Detect the kind of external URL.
    Returns: 'rule34', 'multporn', 'ph', 'webpage', 'direct_image', 'video', 'unknown'
    """
    url = url.lower()
    
    # Rule34
    if 'rule34.xxx' in url or 'rule34.paheal.net' in url:
        return 'rule34'
    
    # Multporn
    if 'multporn.net' in url:
        return 'multporn'
    
    # Pornhub
    if 'pornhub.com' in url:
        return 'ph'
    
    # Direct image URLs
    if url.endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')):
        return 'direct_image'
    
    # Direct video URLs
    if url.endswith(('.mp4', '.webm', '.mkv', '.avi')):
        return 'video'
    
    # Default to webpage
    return 'webpage'
