// The app icon each design can show at the top of the frame. Kept apart from
// design.js, which is plain numbers and strings that the tests import in node:
// these are image files, which only a bundler knows how to turn into URLs.
//
// KarmaLab has none — it is the box's own look, not someone else's app.

import chatgpt from './icons/chatgpt.png';
import claude from './icons/claude.png';

export const APP_ICONS = { claude, chatgpt };

export const appIconFor = (designId) => APP_ICONS[designId] || null;
