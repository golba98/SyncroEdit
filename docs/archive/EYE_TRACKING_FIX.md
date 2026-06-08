# SynchroBot Eye-Tracking Bug Fix

## Problem Summary
The robot mascot's eyes were snapping to the far right (maximum positive X) when they should have been looking left at the login input fields on the left side of the screen.

## Root Causes Identified

### 1. **Coordinate Mapping Issue** (Primary Bug)
**Problem:** The eye-tracking calculation was using incorrect coordinate references, causing the eyes to look in the opposite direction.

**Solution:** Implemented proper viewport coordinate mapping:
```javascript
// Get eye center in viewport coordinates
const eyeRect = eye.getBoundingClientRect();
const eyeCenterX = eyeRect.left + eyeRect.width / 2;
const eyeCenterY = eyeRect.top + eyeRect.height / 2;

// Calculate delta: target MINUS eye center
const deltaX = target.x - eyeCenterX;
const deltaY = target.y - eyeCenterY;
```

**Why this works:**
- When the mascot is on the RIGHT and input is on the LEFT:
  - `target.x` (input position) < `eyeCenterX` (eye position)
  - `deltaX = target.x - eyeCenterX` = **negative value**
  - Negative deltaX correctly moves pupils LEFT

### 2. **Focus State Logic**
**Problem:** When input fields were focused, the eye position could default to invalid values (0, NaN, or Infinity) if element bounds weren't calculated correctly.

**Solution:** Added validation and proper element tracking:
```javascript
trackElement(element) {
  if (!element) {
    this.targetElement = null;
    return;
  }
  
  const rect = element.getBoundingClientRect();
  const targetX = rect.left + rect.width / 2;
  const targetY = rect.top + rect.height / 2;
  
  // Validate coordinates
  if (isNaN(targetX) || isNaN(targetY) || !isFinite(targetX) || !isFinite(targetY)) {
    console.warn('SynchroBot: Invalid element coordinates, resetting to center');
    this.resetEyePosition();
    return;
  }
  
  this.updateEyePosition({ x: targetX, y: targetY });
}
```

### 3. **The Math - Transform Calculation**
**Problem:** Pupils need to move relative to their centered position (transform: translate(-50%, -50%)).

**Solution:** Applied offset using `calc()` to maintain center-based positioning:
```javascript
const angle = Math.atan2(deltaY, deltaX);
const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
const moveDistance = Math.min(distance, this.config.eyeMaxMove); // Clamp to 8px

const offsetX = Math.cos(angle) * moveDistance;
const offsetY = Math.sin(angle) * moveDistance;

// Maintain -50% centering and add the offset
pupil.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
```

## Implementation Details

### Files Created
1. **`public/js/features/auth/synchro/SynchroBot.js`** - Main component
   - Eye tracking logic
   - State management (idle, tracking, secure, peeking, processing, success, error, bored)
   - Element tracking with proper coordinate mapping

2. **`public/js/features/auth/authController.js`** - Integration controller
   - Form event listeners
   - Field focus/blur handling
   - Password toggle integration
   - Form completeness tracking

3. **`config/.babelrc`** - Babel configuration for Jest tests

### Key Methods

#### `updateEyePosition(target)`
Core eye-tracking method that:
- Uses `.getBoundingClientRect()` to get eye position in viewport space
- Calculates delta vector from eye center to target
- Applies `atan2` for angle calculation
- Clamps movement to `eyeMaxMove` (8px)
- Applies transform with proper centering

#### `trackElement(element)`
Tracks DOM elements (input fields):
- Gets element bounds with `.getBoundingClientRect()`
- Calculates center point of element
- Validates coordinates (checks for NaN/Infinity)
- Passes coordinates to `updateEyePosition()`

#### `onFieldFocus(fieldName, fieldValue)`
Handles input focus events:
- For password fields: centers eyes (secure mode)
- For text fields: tracks the focused element
- Uses `document.activeElement` for accurate element detection

## Testing

All 13 unit tests pass:
```
✓ should initialize with default state
✓ should initialize with forgot flow state
✓ should return false if container not found
✓ should transition to tracking on username focus
✓ should transition to secure on password focus (hidden)
✓ should transition to peeking when password visible
✓ should transition to processing on submit
✓ should transition to success after submit success
✓ should transition to error after submit error
✓ should transition to bored after 10s idle
✓ should reset idle timer on input
✓ should show hover-blocked when form empty
✓ should show hover-ready when form valid
```

## Verification

A test page was created at `public/pages/test-eye-tracking.html` with:
- Debug overlay showing target coordinates, eye center, and delta values
- Visual confirmation that deltaX shows "← LEFT" when input is on the left
- Real-time tracking visualization

## Pages Updated
- `public/pages/login.html` - Already had script tag
- `public/pages/forgot-password.html` - Added authController.js script
- `public/pages/reset-password.html` - Added authController.js script

## Expected Behavior
✅ **Before Fix:** Eyes snap to far right when focusing left-side inputs
✅ **After Fix:** Eyes correctly track input fields on the left, looking in the proper direction based on relative position to the mascot

The eye-tracking now accurately follows the cursor and input fields using proper coordinate space calculations with `.getBoundingClientRect()` relative to the eye center position.
