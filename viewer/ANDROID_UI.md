# Android UI Styling Reference

This document explains how to tweak the Android app's appearance. The Android app is a native shell around the same React UI, so most styling is done in the frontend code.

## Global Styling

### Main CSS File
**Location:** `frontend/src/styles/global.css`

This file controls:
- Color scheme (CSS variables)
- Base typography
- Button styles
- Input styles
- Scrollbar styling
- Mobile responsive breakpoints

**Key CSS Variables:**
```css
--bg:       #0a0a0a;      /* Background color */
--surface:  #111;          /* Surface color */
--accent:   #e8ff47;       /* Accent color */
--text:     #f0f0f0;       /* Text color */
--muted:    #555;          /* Muted text color */
--nav-h:    52px;          /* Navigation height */
```

**Mobile Responsive Breakpoints:**
- `@media (max-width: 768px)` - Tablets and large phones
- `@media (max-width: 480px)` - Small phones

### Mobile-Specific CSS
**Location:** `frontend/src/styles/global.css` (lines 91-146)

Mobile optimizations include:
- Larger touch targets (44px minimum)
- Prevented zoom on input focus
- Better touch scrolling
- Removed tap highlight on buttons

## Component Styling

### Main Pages
Each page in `frontend/src/pages/` may have inline styles. Key pages:

- **Library.jsx** - Main library view with grid layout
- **Browse.jsx** - Browse timeline view
- **Subscriptions.jsx** - Subscription feed with action buttons
- **Collections.jsx** - Collections management
- **Viewer.jsx** - Full-screen media viewer
- **Selection.jsx** - Selection management

### Components
**Location:** `frontend/src/components/`

- **PostGrid.jsx** - Grid layout for posts
- **TagSearch.jsx** - Tag search interface

## Capacitor Configuration

### Main Config
**Location:** `capacitor.config.ts`

Controls:
- App ID: `com.vault.viewer`
- App name: `Vault`
- Web directory: `frontend/dist`
- Android scheme: `https`

### Android Native Configuration
**Location:** `android/` directory

Key files:
- `android/app/src/main/AndroidManifest.xml` - App permissions, theme
- `android/app/src/main/res/values/styles.xml` - Native Android styles
- `android/app/src/main/res/values/colors.xml` - Native Android colors

## Android-Specific Adjustments

### Status Bar
Controlled via Capacitor System Bars plugin. To customize:
```typescript
import { StatusBar } from '@capacitor/status-bar';

// Hide status bar
StatusBar.hide();

// Change style
StatusBar.setStyle({ style: Style.Dark });
```

### Safe Area
Add padding for notches/status bars in CSS:
```css
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);
```

### Font Scaling
Prevent system font scaling from breaking layout:
```css
html {
  text-size-adjust: 100%;
  -webkit-text-size-adjust: 100%;
}
```

## Common Android UI Issues

### 1. Text Too Small on Mobile
**Fix:** Increase base font size in `global.css`:
```css
@media (max-width: 480px) {
  body {
    font-size: 16px; /* Increase from 15px */
  }
}
```

### 2. Buttons Too Small to Tap
**Fix:** Ensure minimum 44px tap targets (already in global.css)

### 3. Keyboard Covers Input Fields
**Fix:** Add viewport meta tag in `frontend/index.html`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

### 4. Images Not Responsive
**Fix:** Add to global CSS:
```css
img, video {
  max-width: 100%;
  height: auto;
}
```

## Testing Android Changes

1. Make CSS/component changes
2. Rebuild web assets: `npm run build:android`
3. Sync to Android: `npm run cap:sync android`
4. Rebuild APK in Android Studio
5. Test on device/emulator

## Color Scheme Customization

To change the app's color scheme, modify CSS variables in `frontend/src/styles/global.css`:

```css
:root {
  --bg:       #YOUR_BG_COLOR;
  --surface:  #YOUR_SURFACE_COLOR;
  --accent:   #YOUR_ACCENT_COLOR;
  --text:     #YOUR_TEXT_COLOR;
}
```

## Typography

### Font Families
- **Monospace:** `DM Mono`, `Courier New`, monospace
- **Display:** `Syne`, sans-serif

To change fonts, modify in `global.css`:
```css
--font-mono: 'Your Font', monospace;
--font-display: 'Your Font', sans-serif;
```

## Performance Tips

1. **Avoid heavy animations** on mobile
2. **Use CSS transforms** instead of position changes
3. **Lazy load images** in grids
4. **Debounce input handlers** for search fields
